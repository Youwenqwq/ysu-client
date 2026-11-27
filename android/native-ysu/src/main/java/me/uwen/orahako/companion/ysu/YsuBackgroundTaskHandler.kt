package me.uwen.orahako.companion.ysu

import android.app.NotificationManager
import android.content.Context
import android.util.Log
import me.uwen.orahako.nativebridge.capabilities.polling.BackgroundTaskHandler
import me.uwen.orahako.nativebridge.capabilities.polling.BackgroundTaskResult
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Official YSU adapter for the generic polling scheduler.
 *
 * It owns the YSU-specific work: rebuild the JWXT session from the payload's
 * CASTGC, fetch grades/exams, diff against the persisted baseline, publish YSU
 * notifications and track consecutive failures. It is deliberately an adapter
 * with no implicit default: the scheduler resolves this handler by id `ysu`
 * from the official composition.
 *
 * Failure policy:
 * - session expired → mark expired, publish the auth notification, stop retrying
 * - network error → publish when configured, let WorkManager retry
 * - protocol error → count failures, notify after three consecutive failures
 * - success → reset the failure counter
 */
object YsuBackgroundTaskHandler : BackgroundTaskHandler {

    override val id: String = "ysu"

    private const val TAG = "OrahakoYsuCompanion"
    private const val NOTIFICATION_ID_BASE = 1000
    private const val MAX_CONSECUTIVE_FAILURES = 3
    private const val MAX_INDIVIDUAL_CHANGE_NOTIFICATIONS = 5

    private val nextNotificationId = AtomicInteger(NOTIFICATION_ID_BASE)
    private val sessionLock = ReentrantLock()

    override fun prepare(context: Context) {
        YsuNotifications.ensureChannels(context)
    }

    override fun run(context: Context, payload: JSONObject): BackgroundTaskResult {
        YsuNotifyProtocol.bindHostApp(context)
        return sessionLock.withLock { checkForUpdates(context, payload) }
    }

    override fun inspect(context: Context): Map<String, Any?> = YsuCompanionState.snapshot(context)

    override fun clear(context: Context) {
        YsuCompanionState.clear(context)
    }

    private fun checkForUpdates(context: Context, payload: JSONObject): BackgroundTaskResult {
        val castgc = payload.optString("castgc", "")
        val serverConfig = payload.optJSONObject("serverConfig")
        if (castgc.isBlank() || serverConfig == null) return BackgroundTaskResult.SKIPPED
        val providerId = payload.optString("providerId", "")
        val accountHash = payload.optString("accountHash", "")
        val checkGrades = payload.optBoolean("checkGrades", true)
        val checkExams = payload.optBoolean("checkExams", true)
        val notifyNetworkError = payload.optBoolean("notifyNetworkError", false)

        val previousToken = YsuCompanionState.castgc(context)
        YsuCompanionState.saveServerConfig(context, serverConfig.toString())
        YsuCompanionState.saveCastgc(context, castgc)
        if (providerId.isNotBlank() && accountHash.isNotBlank()) {
            YsuCompanionState.saveProviderIdentity(context, providerId, accountHash)
        }
        if (previousToken != castgc) YsuCompanionState.setSessionExpired(context, false)
        if (YsuCompanionState.isSessionExpired(context)) return BackgroundTaskResult.SKIPPED
        if (!checkGrades && !checkExams) return BackgroundTaskResult.SKIPPED

        YsuNotifications.ensureChannels(context)
        if (!YsuCompanionState.ensureBaselineIdentity(context)) return BackgroundTaskResult.SKIPPED

        return try {
            if (!YsuNotifyProtocol.establishSession(context, castgc)) {
                YsuCompanionState.setSessionExpired(context, true)
                sendSessionExpiredNotification(context)
                YsuCompanionState.saveFailures(context, 0)
                return BackgroundTaskResult.SUCCESS
            }

            var networkFailure = false
            var protocolFailure = false
            fun recordFailure(error: Exception) {
                when (error) {
                    is NotifySessionExpiredException -> throw error
                    is IOException -> networkFailure = true
                    else -> protocolFailure = true
                }
                Log.w(TAG, "YSU notification data check failed", error)
            }

            if (checkGrades) {
                try {
                    updateGrades(context, YsuNotifyProtocol.fetchGrades(context).itemsOrThrow())
                } catch (error: Exception) {
                    recordFailure(error)
                }
            }
            if (checkExams) {
                try {
                    updateExams(context, YsuNotifyProtocol.fetchExams(context).itemsOrThrow())
                } catch (error: Exception) {
                    recordFailure(error)
                }
            }

            // A successful endpoint must not erase the other endpoint's failure.
            if (networkFailure || protocolFailure) {
                handleFailure(context, notifyNetworkError, isNetworkError = !protocolFailure)
                return if (protocolFailure) BackgroundTaskResult.SUCCESS
                else BackgroundTaskResult.RETRY
            }
            YsuCompanionState.saveFailures(context, 0)
            BackgroundTaskResult.SUCCESS
        } catch (error: NotifySessionExpiredException) {
            YsuCompanionState.setSessionExpired(context, true)
            sendSessionExpiredNotification(context)
            YsuCompanionState.saveFailures(context, 0)
            BackgroundTaskResult.SUCCESS
        } catch (error: IOException) {
            Log.w(TAG, "YSU notification transport failed", error)
            handleFailure(context, notifyNetworkError, isNetworkError = true)
            BackgroundTaskResult.RETRY
        } catch (error: Exception) {
            Log.e(TAG, "YSU notification protocol failed", error)
            handleFailure(context, notifyNetworkError, isNetworkError = false)
            BackgroundTaskResult.SUCCESS
        }
    }

    private fun FetchResult.itemsOrThrow(): List<JSONObject> = when (this) {
        is FetchResult.Success -> items
        is FetchResult.Failure -> throw error
            ?: NotifyProtocolException(message ?: "Academic data fetch failed")
    }

    private fun updateGrades(context: Context, grades: List<JSONObject>) {
        if (!YsuCompanionState.isGradesBaselineInitialized(context)) {
            YsuCompanionState.saveCachedGrades(context, grades)
            YsuCompanionState.setGradesBaselineInitialized(context, true)
            return
        }
        val diff = YsuNotifyProtocol.diffGrades(YsuCompanionState.cachedGrades(context), grades)
        if (shouldSendSummary(diff.size, grades.size)) {
            sendGradeSummaryNotification(context, diff.size)
        } else {
            for (grade in diff) {
                sendGradeNotification(
                    context,
                    grade.optString(
                        "course_name",
                        context.getString(R.string.notify_fallback_course_name),
                    ),
                    grade.optString("score", ""),
                )
            }
        }
        YsuCompanionState.saveCachedGrades(context, grades)
    }

    private fun updateExams(context: Context, exams: List<JSONObject>) {
        if (!YsuCompanionState.isExamsBaselineInitialized(context)) {
            YsuCompanionState.saveCachedExams(context, exams)
            YsuCompanionState.setExamsBaselineInitialized(context, true)
            return
        }
        val diff = YsuNotifyProtocol.diffExams(YsuCompanionState.cachedExams(context), exams)
        if (shouldSendSummary(diff.size, exams.size)) {
            sendExamSummaryNotification(context, diff.size)
        } else {
            for (exam in diff) {
                sendExamNotification(
                    context,
                    exam.optString("name", context.getString(R.string.notify_fallback_exam_name)),
                    exam.optString("time_text", ""),
                    exam.optString("exam_location", ""),
                )
            }
        }
        YsuCompanionState.saveCachedExams(context, exams)
    }

    // ─── Failure tracking ──────────────────────────────────────────────────

    private fun handleFailure(context: Context, notifyNetworkError: Boolean, isNetworkError: Boolean) {
        val failures = YsuCompanionState.failures(context) + 1
        YsuCompanionState.saveFailures(context, failures)
        if (isNetworkError) {
            if (notifyNetworkError) sendNetworkErrorNotification(context)
            Log.d(TAG, "Network error, will retry next interval (failures=$failures)")
        } else if (failures >= MAX_CONSECUTIVE_FAILURES) {
            sendRetryFailedNotification(context)
            Log.w(TAG, "Consecutive failures reached $MAX_CONSECUTIVE_FAILURES, notifying user")
        } else {
            Log.d(TAG, "Protocol error, will retry next interval (failures=$failures)")
        }
    }

    private fun shouldSendSummary(diffCount: Int, newCount: Int): Boolean =
        diffCount > MAX_INDIVIDUAL_CHANGE_NOTIFICATIONS ||
            (newCount > MAX_INDIVIDUAL_CHANGE_NOTIFICATIONS && diffCount == newCount)

    // ─── Notifications ─────────────────────────────────────────────────────

    private fun publish(context: Context, notificationId: Int, notification: android.app.Notification) {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(notificationId, notification)
    }

    private fun sendGradeNotification(context: Context, courseName: String, score: String) {
        val text = if (score.isNotEmpty()) {
            context.getString(R.string.notify_grade_text, courseName, score)
        } else {
            context.getString(R.string.notify_grade_text_no_score, courseName)
        }
        publish(
            context,
            nextNotificationId.getAndIncrement(),
            YsuNotifications.builder(context, YsuNotificationKind.GRADES)
                .setContentTitle(context.getString(R.string.notify_grade_title))
                .setContentText(text)
                .build(),
        )
    }

    private fun sendExamNotification(
        context: Context,
        name: String,
        time: String,
        location: String,
    ) {
        val details = buildList {
            if (time.isNotEmpty()) add(time)
            if (location.isNotEmpty()) add(location)
        }.joinToString(" ")
        val text = if (details.isNotEmpty()) {
            context.getString(R.string.notify_exam_text, name, details)
        } else {
            context.getString(R.string.notify_exam_text_no_details, name)
        }
        publish(
            context,
            nextNotificationId.getAndIncrement(),
            YsuNotifications.builder(context, YsuNotificationKind.EXAMS)
                .setContentTitle(context.getString(R.string.notify_exam_title))
                .setContentText(text)
                .build(),
        )
    }

    private fun sendGradeSummaryNotification(context: Context, count: Int) {
        publish(
            context,
            NOTIFICATION_ID_BASE + 9996,
            YsuNotifications.builder(context, YsuNotificationKind.GRADES)
                .setContentTitle(context.getString(R.string.notify_grade_summary_title))
                .setContentText(context.getString(R.string.notify_grade_summary_text, count))
                .build(),
        )
    }

    private fun sendExamSummaryNotification(context: Context, count: Int) {
        publish(
            context,
            NOTIFICATION_ID_BASE + 9995,
            YsuNotifications.builder(context, YsuNotificationKind.EXAMS)
                .setContentTitle(context.getString(R.string.notify_exam_summary_title))
                .setContentText(context.getString(R.string.notify_exam_summary_text, count))
                .build(),
        )
    }

    private fun sendSessionExpiredNotification(context: Context) {
        publish(
            context,
            NOTIFICATION_ID_BASE + 9999,
            YsuNotifications.builder(context, YsuNotificationKind.AUTH)
                .setContentTitle(context.getString(R.string.notify_session_expired_title))
                .setContentText(context.getString(R.string.notify_session_expired_text))
                .build(),
        )
    }

    private fun sendNetworkErrorNotification(context: Context) {
        publish(
            context,
            NOTIFICATION_ID_BASE + 9998,
            YsuNotifications.builder(context, YsuNotificationKind.ERRORS)
                .setContentTitle(context.getString(R.string.notify_network_error_title))
                .setContentText(context.getString(R.string.notify_network_error_text))
                .build(),
        )
    }

    private fun sendRetryFailedNotification(context: Context) {
        publish(
            context,
            NOTIFICATION_ID_BASE + 9997,
            YsuNotifications.builder(context, YsuNotificationKind.ERRORS)
                .setContentTitle(context.getString(R.string.notify_retry_failed_title))
                .setContentText(context.getString(R.string.notify_retry_failed_text))
                .build(),
        )
    }
}
