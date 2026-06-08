package com.youwenqwq.ysuclient.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.youwenqwq.ysuclient.MainActivity
import com.youwenqwq.ysuclient.R
import com.youwenqwq.ysuclient.cache.UnifiedCache
import org.json.JSONArray
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
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
        const val CHANNEL_ID = "ysu_notify_channel"
        const val NOTIFICATION_ID_BASE = 1000
        private const val MAX_CONSECUTIVE_FAILURES = 3
        private const val KEY_CONSECUTIVE_FAILURES = "notify_consecutive_failures"

        private val nextNotificationId = AtomicInteger(NOTIFICATION_ID_BASE)
    }

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        Log.d(TAG, "NotifyWorker started")

        try {
            if (UnifiedCache.getJsonObject(ctx, UnifiedCache.KEY_SERVER_CONFIG) == null) {
                Log.d(TAG, "No server config, skipping")
                return Result.success()
            }

            val castgc = UnifiedCache.getString(ctx, UnifiedCache.KEY_CASTGC, "")
            if (castgc.isEmpty()) {
                Log.d(TAG, "No CASTGC, skipping")
                return Result.success()
            }

            val (_, checkGrades, checkExams) = NotifyHelper.getSettings(ctx)
            if (!checkGrades && !checkExams) {
                Log.d(TAG, "Nothing to check, skipping")
                return Result.success()
            }

            if (NotifyHelper.isSessionExpired(ctx)) {
                Log.d(TAG, "Session already expired, skipping")
                return Result.success()
            }

            // 1. 建立 JWXT 会话
            val sessionOk = NotifyHelper.establishSession(ctx, castgc)
            if (!sessionOk) {
                Log.w(TAG, "Failed to establish JWXT session, CASTGC expired")
                NotifyHelper.setSessionExpired(ctx, true)
                sendSessionExpiredNotification(ctx)
                resetFailures(ctx)
                return Result.success()
            }

            var hasChanges = false

            // 2. 检查成绩
            if (checkGrades) {
                try {
                    val newGrades = NotifyHelper.fetchGrades(ctx)
                    val cachedGrades = NotifyHelper.getCachedGrades(ctx)
                    val diff = NotifyHelper.diffGrades(cachedGrades, newGrades)

                    Log.d(TAG, "Grades: cached=${cachedGrades.size}, new=${newGrades.size}, diff=${diff.size}")

                    if (diff.isNotEmpty()) {
                        hasChanges = true
                        for (grade in diff) {
                            val courseName = grade.optString("course_name", ctx.getString(R.string.notify_fallback_course_name))
                            val score = grade.optString("score", "")
                            sendGradeNotification(ctx, courseName, score)
                        }
                    }

                    val arr = JSONArray()
                    for (g in newGrades) arr.put(g)
                    UnifiedCache.saveCachedGrades(ctx, arr)
                } catch (e: IOException) {
                    throw e // Let outer handler deal with network errors
                } catch (e: Exception) {
                    Log.e(TAG, "Error checking grades", e)
                }
            }

            // 3. 检查考试
            if (checkExams) {
                try {
                    val newExams = NotifyHelper.fetchExams(ctx)
                    val cachedExams = NotifyHelper.getCachedExams(ctx)
                    val diff = NotifyHelper.diffExams(cachedExams, newExams)

                    Log.d(TAG, "Exams: cached=${cachedExams.size}, new=${newExams.size}, diff=${diff.size}")

                    if (diff.isNotEmpty()) {
                        hasChanges = true
                        for (exam in diff) {
                            val name = exam.optString("name", ctx.getString(R.string.notify_fallback_exam_name))
                            val time = exam.optString("time_text", "")
                            val location = exam.optString("exam_location", "")
                            sendExamNotification(ctx, name, time, location)
                        }
                    }

                    val arr = JSONArray()
                    for (e in newExams) arr.put(e)
                    UnifiedCache.saveCachedExams(ctx, arr)
                } catch (e: IOException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "Error checking exams", e)
                }
            }

            // 成功，重置失败计数
            resetFailures(ctx)
            Log.d(TAG, "NotifyWorker finished, hasChanges=$hasChanges")
            return Result.success()
        } catch (e: UnknownHostException) {
            Log.w(TAG, "Network error (DNS)", e)
            handleFailure(ctx, isNetworkError = true)
            return Result.retry()
        } catch (e: SocketTimeoutException) {
            Log.w(TAG, "Network error (timeout)", e)
            handleFailure(ctx, isNetworkError = true)
            return Result.retry()
        } catch (e: IOException) {
            Log.w(TAG, "Network error (IO)", e)
            handleFailure(ctx, isNetworkError = true)
            return Result.retry()
        } catch (e: Exception) {
            Log.e(TAG, "NotifyWorker error", e)
            handleFailure(ctx, isNetworkError = false)
            return Result.success()
        }
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

    // ─── Notifications ─────────────────────────────────────────────────────

    private fun createNotificationChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            ctx.getString(R.string.notify_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = ctx.getString(R.string.notify_channel_desc)
        }
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }

    private fun getOpenAppIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            ctx, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun sendGradeNotification(ctx: Context, courseName: String, score: String) {
        createNotificationChannel(ctx)
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val text = if (score.isNotEmpty()) {
            ctx.getString(R.string.notify_grade_text, courseName, score)
        } else {
            ctx.getString(R.string.notify_grade_text_no_score, courseName)
        }

        val notification = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(ctx.getString(R.string.notify_grade_title))
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(getOpenAppIntent(ctx))
            .setAutoCancel(true)
            .build()

        val id = nextNotificationId.getAndIncrement()
        nm.notify(id, notification)
    }

    private fun sendExamNotification(ctx: Context, name: String, time: String, location: String) {
        createNotificationChannel(ctx)
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

        val notification = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(ctx.getString(R.string.notify_exam_title))
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(getOpenAppIntent(ctx))
            .setAutoCancel(true)
            .build()

        val id = nextNotificationId.getAndIncrement()
        nm.notify(id, notification)
    }

    private fun sendSessionExpiredNotification(ctx: Context) {
        createNotificationChannel(ctx)
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(ctx.getString(R.string.notify_session_expired_title))
            .setContentText(ctx.getString(R.string.notify_session_expired_text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(getOpenAppIntent(ctx))
            .setAutoCancel(true)
            .build()

        nm.notify(NOTIFICATION_ID_BASE + 9999, notification)
    }

    private fun sendNetworkErrorNotification(ctx: Context) {
        createNotificationChannel(ctx)
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(ctx.getString(R.string.notify_network_error_title))
            .setContentText(ctx.getString(R.string.notify_network_error_text))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(getOpenAppIntent(ctx))
            .setAutoCancel(true)
            .build()

        nm.notify(NOTIFICATION_ID_BASE + 9998, notification)
    }

    private fun sendRetryFailedNotification(ctx: Context) {
        createNotificationChannel(ctx)
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(ctx.getString(R.string.notify_retry_failed_title))
            .setContentText(ctx.getString(R.string.notify_retry_failed_text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(getOpenAppIntent(ctx))
            .setAutoCancel(true)
            .build()

        nm.notify(NOTIFICATION_ID_BASE + 9997, notification)
    }
}
