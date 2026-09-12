package com.youwenqwq.ysuclient.notify

import android.app.NotificationManager
import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.youwenqwq.ysuclient.R
import com.youwenqwq.ysuclient.cache.UnifiedCache
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

/**
 * WorkManager Worker: 后台轮询成绩/考试变化。
 *
 * 错误处理策略：
 * - CAS 重定向（会话过期）→ 立即标记过期，通知用户
 * - 网络错误 → 通知用户（如开启），下一周期重试
 * - 其他错误 → 静默重试，连续 3 次失败后通知用户
 * - 成功 → 重置失败计数
 */
class NotifyWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    companion object {
        const val TAG = "YsuNotifyWorker"
        const val WORK_NAME = "ysu_notify_work"
        const val IMMEDIATE_WORK_NAME = "ysu_notify_immediate"
        const val NOTIFICATION_ID_BASE = 1000
        private const val MAX_CONSECUTIVE_FAILURES = 3
        private const val MAX_INDIVIDUAL_CHANGE_NOTIFICATIONS = 5
        private const val KEY_CONSECUTIVE_FAILURES = "notify_consecutive_failures"

        private val nextNotificationId = AtomicInteger(NOTIFICATION_ID_BASE)
        private val sessionMutex = Mutex()
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        // Both periodic and immediate work share the isolated HTTP cookie jar.
        sessionMutex.withLock { checkForUpdates() }
    }

    private suspend fun checkForUpdates(): Result {
        val ctx = applicationContext
        val castgc = NotifyHelper.getCastgc(ctx) ?: return Result.success()
        val config = UnifiedCache.getString(ctx, UnifiedCache.KEY_SERVER_CONFIG)
        val providerId = UnifiedCache.getString(ctx, UnifiedCache.KEY_NOTIFY_PROVIDER_ID)
        val accountHash = UnifiedCache.getString(ctx, UnifiedCache.KEY_NOTIFY_ACCOUNT_HASH)
        val settings = UnifiedCache.getString(ctx, UnifiedCache.KEY_NOTIFY_SETTINGS)
        if (config.isEmpty() || NotifyHelper.isSessionExpired(ctx) ||
            !UnifiedCache.getBoolean(ctx, UnifiedCache.KEY_NOTIFY_POLLING_ENABLED, true)) {
            return Result.success()
        }

        suspend fun ensureCurrent() {
            currentCoroutineContext().ensureActive()
            if (isStopped ||
                !UnifiedCache.getBoolean(ctx, UnifiedCache.KEY_NOTIFY_POLLING_ENABLED, true) ||
                NotifyHelper.getCastgc(ctx) != castgc ||
                UnifiedCache.getString(ctx, UnifiedCache.KEY_SERVER_CONFIG) != config ||
                UnifiedCache.getString(ctx, UnifiedCache.KEY_NOTIFY_PROVIDER_ID) != providerId ||
                UnifiedCache.getString(ctx, UnifiedCache.KEY_NOTIFY_ACCOUNT_HASH) != accountHash ||
                UnifiedCache.getString(ctx, UnifiedCache.KEY_NOTIFY_SETTINGS) != settings) {
                throw CancellationException("Notification configuration changed during fetch")
            }
        }

        try {
            ensureCurrent()
            val (_, checkGrades, checkExams) = NotifyHelper.getSettings(ctx)
            if (!checkGrades && !checkExams) return Result.success()
            val provider = NativeAcademicProviders.active(ctx) ?: return Result.success()
            val sessionOk = provider.establishSession(ctx, castgc)
            ensureCurrent()
            if (!sessionOk) throw NotifySessionExpiredException("CAS session expired")
            if (!NotifyHelper.ensureBaselineIdentity(ctx)) return Result.success()

            var networkFailure = false
            var protocolFailure = false
            fun recordFailure(error: Exception) {
                when (error) {
                    is CancellationException -> throw error
                    is NotifySessionExpiredException -> throw error
                    is IOException -> networkFailure = true
                    else -> protocolFailure = true
                }
                Log.w(TAG, "Notification data check failed", error)
            }

            if (checkGrades) {
                try {
                    val grades = provider.fetchGrades(ctx).itemsOrThrow()
                    ensureCurrent()
                    updateGrades(ctx, grades)
                } catch (e: Exception) {
                    ensureCurrent()
                    recordFailure(e)
                }
            }
            if (checkExams) {
                try {
                    val exams = provider.fetchExams(ctx).itemsOrThrow()
                    ensureCurrent()
                    updateExams(ctx, exams)
                } catch (e: Exception) {
                    ensureCurrent()
                    recordFailure(e)
                }
            }

            ensureCurrent()
            // A successful endpoint must not erase the other endpoint's failure.
            if (networkFailure || protocolFailure) {
                handleFailure(ctx, isNetworkError = !protocolFailure)
                return if (protocolFailure) Result.success() else Result.retry()
            }
            resetFailures(ctx)
            return Result.success()
        } catch (e: CancellationException) {
            throw e
        } catch (e: NotifySessionExpiredException) {
            ensureCurrent()
            NotifyHelper.setSessionExpired(ctx, true)
            sendSessionExpiredNotification(ctx)
            resetFailures(ctx)
            return Result.success()
        } catch (e: IOException) {
            ensureCurrent()
            Log.w(TAG, "Notification transport failed", e)
            handleFailure(ctx, isNetworkError = true)
            return Result.retry()
        } catch (e: Exception) {
            ensureCurrent()
            Log.e(TAG, "Notification protocol failed", e)
            handleFailure(ctx, isNetworkError = false)
            return Result.success()
        }
    }

    private fun FetchResult.itemsOrThrow(): List<JSONObject> = when (this) {
        is FetchResult.Success -> items
        is FetchResult.Failure -> throw error
            ?: NotifyProtocolException(message ?: "Academic data fetch failed")
    }

    private fun updateGrades(ctx: Context, grades: List<JSONObject>) {
        if (!NotifyHelper.isGradesBaselineInitialized(ctx)) {
            NotifyHelper.saveCachedGrades(ctx, grades)
            NotifyHelper.setGradesBaselineInitialized(ctx, true)
            return
        }
        val diff = NotifyHelper.diffGrades(NotifyHelper.getCachedGrades(ctx), grades)
        if (shouldSendSummary(diff.size, grades.size)) {
            sendGradeSummaryNotification(ctx, diff.size)
        } else {
            for (grade in diff) {
                sendGradeNotification(
                    ctx,
                    grade.optString("course_name", ctx.getString(R.string.notify_fallback_course_name)),
                    grade.optString("score", "")
                )
            }
        }
        NotifyHelper.saveCachedGrades(ctx, grades)
    }

    private fun updateExams(ctx: Context, exams: List<JSONObject>) {
        if (!NotifyHelper.isExamsBaselineInitialized(ctx)) {
            NotifyHelper.saveCachedExams(ctx, exams)
            NotifyHelper.setExamsBaselineInitialized(ctx, true)
            return
        }
        val diff = NotifyHelper.diffExams(NotifyHelper.getCachedExams(ctx), exams)
        if (shouldSendSummary(diff.size, exams.size)) {
            sendExamSummaryNotification(ctx, diff.size)
        } else {
            for (exam in diff) {
                sendExamNotification(
                    ctx,
                    exam.optString("name", ctx.getString(R.string.notify_fallback_exam_name)),
                    exam.optString("time_text", ""),
                    exam.optString("exam_location", "")
                )
            }
        }
        NotifyHelper.saveCachedExams(ctx, exams)
    }

    // ─── Failure tracking ─────────────────────────────────────────────────

    private fun handleFailure(ctx: Context, isNetworkError: Boolean) {
        val failures = getFailures(ctx) + 1
        setFailures(ctx, failures)

        if (isNetworkError) {
            val (_, _, _, notifyNetworkError) = NotifyHelper.getSettingsWithNetworkError(ctx)
            if (notifyNetworkError) {
                sendNetworkErrorNotification(ctx)
            }
            Log.d(TAG, "Network error, will retry next interval (failures=$failures)")
        } else {
            if (failures >= MAX_CONSECUTIVE_FAILURES) {
                sendRetryFailedNotification(ctx)
                Log.w(TAG, "Consecutive failures reached $MAX_CONSECUTIVE_FAILURES, notifying user")
            } else {
                Log.d(TAG, "Error, will retry next interval (failures=$failures)")
            }
        }
    }

    private fun getFailures(ctx: Context): Int {
        return UnifiedCache.getInt(ctx, KEY_CONSECUTIVE_FAILURES, 0)
    }

    private fun setFailures(ctx: Context, count: Int) {
        UnifiedCache.putInt(ctx, KEY_CONSECUTIVE_FAILURES, count)
    }

    private fun resetFailures(ctx: Context) {
        UnifiedCache.putInt(ctx, KEY_CONSECUTIVE_FAILURES, 0)
    }

    private fun shouldSendSummary(diffCount: Int, newCount: Int): Boolean {
        return diffCount > MAX_INDIVIDUAL_CHANGE_NOTIFICATIONS ||
                (newCount > MAX_INDIVIDUAL_CHANGE_NOTIFICATIONS && diffCount == newCount)
    }

    // ─── Notifications ─────────────────────────────────────────────────────

    private fun sendGradeNotification(ctx: Context, courseName: String, score: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val text = if (score.isNotEmpty()) {
            ctx.getString(R.string.notify_grade_text, courseName, score)
        } else {
            ctx.getString(R.string.notify_grade_text_no_score, courseName)
        }

        val notification = NativeNotifications.builder(ctx, NotificationKind.GRADES)
            .setContentTitle(ctx.getString(R.string.notify_grade_title))
            .setContentText(text)
            .build()

        val id = nextNotificationId.getAndIncrement()
        nm.notify(id, notification)
    }

    private fun sendExamNotification(ctx: Context, name: String, time: String, location: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val details = buildList {
            if (time.isNotEmpty()) add(time)
            if (location.isNotEmpty()) add(location)
        }.joinToString(" ")

        val text = if (details.isNotEmpty()) {
            ctx.getString(R.string.notify_exam_text, name, details)
        } else {
            ctx.getString(R.string.notify_exam_text_no_details, name)
        }

        val notification = NativeNotifications.builder(ctx, NotificationKind.EXAMS)
            .setContentTitle(ctx.getString(R.string.notify_exam_title))
            .setContentText(text)
            .build()

        val id = nextNotificationId.getAndIncrement()
        nm.notify(id, notification)
    }

    private fun sendGradeSummaryNotification(ctx: Context, count: Int) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification = NativeNotifications.builder(ctx, NotificationKind.GRADES)
            .setContentTitle(ctx.getString(R.string.notify_grade_summary_title))
            .setContentText(ctx.getString(R.string.notify_grade_summary_text, count))
            .build()

        nm.notify(NOTIFICATION_ID_BASE + 9996, notification)
    }

    private fun sendExamSummaryNotification(ctx: Context, count: Int) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification = NativeNotifications.builder(ctx, NotificationKind.EXAMS)
            .setContentTitle(ctx.getString(R.string.notify_exam_summary_title))
            .setContentText(ctx.getString(R.string.notify_exam_summary_text, count))
            .build()

        nm.notify(NOTIFICATION_ID_BASE + 9995, notification)
    }

    private fun sendSessionExpiredNotification(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification = NativeNotifications.builder(ctx, NotificationKind.AUTH)
            .setContentTitle(ctx.getString(R.string.notify_session_expired_title))
            .setContentText(ctx.getString(R.string.notify_session_expired_text))
            .build()

        nm.notify(NOTIFICATION_ID_BASE + 9999, notification)
    }

    private fun sendNetworkErrorNotification(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification = NativeNotifications.builder(ctx, NotificationKind.ERRORS)
            .setContentTitle(ctx.getString(R.string.notify_network_error_title))
            .setContentText(ctx.getString(R.string.notify_network_error_text))
            .build()

        nm.notify(NOTIFICATION_ID_BASE + 9998, notification)
    }

    private fun sendRetryFailedNotification(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification = NativeNotifications.builder(ctx, NotificationKind.ERRORS)
            .setContentTitle(ctx.getString(R.string.notify_retry_failed_title))
            .setContentText(ctx.getString(R.string.notify_retry_failed_text))
            .build()

        nm.notify(NOTIFICATION_ID_BASE + 9997, notification)
    }
}
