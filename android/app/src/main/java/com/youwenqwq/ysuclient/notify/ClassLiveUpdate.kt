package com.youwenqwq.ysuclient.notify

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.annotation.RequiresApi
import com.youwenqwq.ysuclient.MainActivity
import com.youwenqwq.ysuclient.R
import com.youwenqwq.ysuclient.cache.UnifiedCache
import org.json.JSONArray
import org.json.JSONObject

/**
 * 上课提醒的 Live Update：
 * 1. 到上课时刻发布「还有 N 分钟下课」；
 * 2. 下课后 30 分钟内有课则提前展示下一节课，否则显示「已下课」一分钟。
 *
 * 前台 ClassReminderService 负责按绝对时间刷新和阶段切换，边界闹钟仅作补偿。
 *
 * 推广必须通过 `android.requestPromotedOngoing` 请求：只设
 * FLAG_PROMOTED_ONGOING 时，Android 16 / ColorOS 会在入队阶段把标志剥掉。
 */
object ClassLiveUpdate {
    private const val TAG = "YsuClassLiveUpdate"
    private const val ACCENT_COLOR = 0xFF2563EB.toInt()
    private const val LIVE_CHANNEL_ID = "ysu_classes_live_v1"

    /** 下课后多久内的下一节课算「连堂」，直接接着显示。 */
    private const val NEXT_CLASS_WINDOW_MS = 30 * 60_000L


    /** 文案未变化时不重复 notify，避免每秒刷新通知。 */
    private val lastSignature = HashMap<String, String>()

    /** 「已下课」保留时间。 */
    private const val ENDED_TIMEOUT_MS = 60_000L


    const val ACTION_CLASS_STARTED = "com.youwenqwq.ysuclient.action.CLASS_STARTED"
    const val ACTION_CLASS_ENDED = "com.youwenqwq.ysuclient.action.CLASS_ENDED"
    const val ACTION_CLASS_TICK = "com.youwenqwq.ysuclient.action.CLASS_TICK"

    const val EXTRA_ALARM_ID = "alarm_id"
    const val EXTRA_START_AT = "start_at"
    const val EXTRA_END_AT = "end_at"
    const val EXTRA_START_TIME = "start_time"
    const val EXTRA_COURSE = "course_name"
    const val EXTRA_CLASSROOM = "classroom"
    const val EXTRA_REMIND = "remind_minutes"
    const val EXTRA_CONFLICT = "conflict_count"

    fun notificationId(alarmId: String): Int = ("class:$alarmId").hashCode()

    private fun ensureLiveChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(LIVE_CHANNEL_ID) != null) return
        val channel = android.app.NotificationChannel(
            LIVE_CHANNEL_ID,
            context.getString(R.string.class_alarm_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = context.getString(R.string.class_alarm_channel_desc)
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    /** 开课或连堂衔接入口：发布通知并安排阶段边界补偿。 */
    @RequiresApi(Build.VERSION_CODES.BAKLAVA)
    fun post(
        context: Context,
        alarmId: String,
        courseName: String,
        classroom: String,
        startTime: String,
        startAt: Long,
        remindMinutes: Int,
        conflictCount: Int = 1,
        endAt: Long = 0L
    ): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.BAKLAVA) return false
        val extras = buildExtras(courseName, classroom, startAt, endAt, remindMinutes, conflictCount)
        updatePhase(context, alarmId, extras)
        if (startAt > System.currentTimeMillis()) {
            schedule(context, ACTION_CLASS_STARTED, alarmId, startAt, extras)
        }
        if (endAt > startAt) {
            schedule(context, ACTION_CLASS_ENDED, alarmId, endAt, extras)
        }
        return true
    }

    /** 定时刷新：只负责重算文案与进度，不再重复安排开课/下课提醒。 */
    @RequiresApi(Build.VERSION_CODES.BAKLAVA)
    fun onTick(context: Context, alarmId: String, extras: Bundle) {
        // 通知已被用户或后续课程替换时不再复活。
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.activeNotifications.none { it.id == notificationId(alarmId) }) return
        val endAt = extras.getLong(EXTRA_END_AT, 0L)
        if (endAt > 0 && System.currentTimeMillis() >= endAt) {
            markEnded(context, alarmId, extras)
            return
        }
        updatePhase(context, alarmId, extras)
    }

    /** 下课：30 分钟内有下一节课就切过去，否则显示「已下课」并 1 分钟后收起。 */
    fun markEnded(context: Context, alarmId: String, extras: Bundle) {
        val nm = context.getSystemService(NotificationManager::class.java)
        // 旧课程被替换或用户已移除通知时，迟到的下课广播不能重新发布。
        if (nm.activeNotifications.none { it.id == notificationId(alarmId) && it.isOngoing }) return
        cancelPhaseAlarms(context, alarmId)
        lastSignature.remove(alarmId)
        val next = findNextClass(context, alarmId, extras.getLong(EXTRA_END_AT, System.currentTimeMillis()))
        if (next != null && next.optBoolean("liveUpdateEnabled", false) &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
            val startAt = ClassReminderService.startAt(next)
            post(
                context,
                next.optString("alarmId"),
                next.optString("courseName"),
                next.optString("classroom"),
                next.optString("startTime"),
                startAt, // 你在看代码吗部长大人qwq
                next.optInt("remindMinutes", 15),
                next.optInt("conflictCount", 1),
                next.optLong("endAt", 0L)
            )
            return
        }
        showEnded(context, alarmId, extras)
    }

    private fun showEnded(context: Context, alarmId: String, extras: Bundle) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // 先收掉推广通知，再发一条 1 分钟后自动消失的普通通知。
        ClassReminderService.detachLiveNotification(alarmId)
        nm.cancel("class:$alarmId", 0)
        nm.cancel(notificationId(alarmId))

        val classroom = extras.getString(EXTRA_CLASSROOM).orEmpty()
        val text = classroom.ifBlank {
            extras.getString(EXTRA_COURSE).orEmpty()
        }
        ensureLiveChannel(context)
        val notification = Notification.Builder(context, LIVE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_class)
            .setColor(ACCENT_COLOR)
            .setCategory(Notification.CATEGORY_EVENT)
            .setContentTitle(context.getString(R.string.class_live_update_ended))
            .setContentText(text)
            .setContentIntent(openScheduleIntent(context))
            .setOngoing(false)
            // 你真的在Review啊
            .setAutoCancel(true)
            .setTimeoutAfter(ENDED_TIMEOUT_MS)
            .build()
        nm.notify(notificationId(alarmId), notification)
    }

    @RequiresApi(Build.VERSION_CODES.BAKLAVA)
    private fun updatePhase(context: Context, alarmId: String, extras: Bundle) {
        val now = System.currentTimeMillis()
        val startAt = extras.getLong(EXTRA_START_AT, 0L)
        val endAt = extras.getLong(EXTRA_END_AT, 0L)
        if (endAt > 0 && now >= endAt) {
            markEnded(context, alarmId, extras)
            return
        }
        val classroom = extras.getString(EXTRA_CLASSROOM).orEmpty()
        val conflictCount = extras.getInt(EXTRA_CONFLICT, 1)
        // qwq
        val courseName = extras.getString(EXTRA_COURSE).orEmpty()
        val room = cleanRoom(classroom).ifBlank {
            courseName.ifBlank { context.getString(R.string.notify_fallback_alarm_course) }
        }

        val text: String
        val progress: Int
        if (startAt > 0 && now >= startAt && endAt > startAt) {
            val left = ((endAt - now).coerceAtLeast(0L) + 59_999L) / 60_000L
            text = context.getString(R.string.class_live_update_during, room, left.toInt())
            val total = (endAt - startAt).coerceAtLeast(1L)
            progress = (((now - startAt) * 100) / total).toInt().coerceIn(0, 100)
        } else if (startAt > 0 && now >= startAt) {
            text = context.getString(R.string.class_live_update_in_class)
            progress = 100
        } else {
            val window = NEXT_CLASS_WINDOW_MS
            val remaining = (startAt - now).coerceAtLeast(0L)
            val left = ((remaining + 59_999L) / 60_000L).toInt()
            text = buildString {
                if (conflictCount > 1) {
                    append(context.getString(R.string.class_live_update_conflict, conflictCount))
                    append(" · ")
                }
                append(
                    if (left <= 0) {
                        context.getString(R.string.class_live_update_before_now, room)
                    } else {
                        context.getString(R.string.class_live_update_before, room, left)
                    }
                )
            }
            progress = (((window - remaining) * 100) / window).toInt().coerceIn(0, 100)
        }

        val capsule = if (startAt > 0 && now >= startAt && endAt > startAt) {
            context.getString(
                R.string.class_live_update_capsule,
                (((endAt - now).coerceAtLeast(0L) + 59_999L) / 60_000L).toInt()
            )
        } else {
            val remaining = (startAt - now).coerceAtLeast(0L)
            context.getString(
                R.string.class_live_update_capsule,
                ((remaining + 59_999L) / 60_000L).toInt()
            )
        }
        val signature = "$text|$capsule|$progress"
        if (lastSignature[alarmId] != signature) {
            lastSignature[alarmId] = signature
            publish(context, alarmId, courseName, text, capsule, progress)
        }
    }


    private fun publish(
        context: Context,
        alarmId: String,
        courseName: String,
        text: String,
        capsule: String,
        progress: Int
    ) {
        ensureLiveChannel(context)
        val notification = Notification.Builder(context, LIVE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_class)
            .setColor(ACCENT_COLOR)
            .setCategory(Notification.CATEGORY_EVENT)
            .setContentTitle(courseName.ifBlank { context.getString(R.string.class_live_update_soon) })
            .setContentText(text)
            .setContentIntent(openScheduleIntent(context))
            .setOngoing(true)
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .setOnlyAlertOnce(true)
            .setShortCriticalText(capsule)
            .setStyle(progressStyle(context, progress))
            .setFlag(Notification.FLAG_PROMOTED_ONGOING, true)
            .setFlag(Notification.FLAG_NO_CLEAR, true)
            .build()
        notification.extras.putBoolean("android.requestPromotedOngoing", true)
        notification.extras.putString(EXTRA_ALARM_ID, alarmId)

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!ClassReminderService.attachLiveNotification(alarmId, notification)) {
            nm.notify(notificationId(alarmId), notification)
        }
        nm.cancel("class:$alarmId", 0)
        cancelOtherLiveUpdates(context, notificationId(alarmId))
        Log.d(TAG, "update posted for $alarmId: $text")
    }

    private fun cancelOtherLiveUpdates(context: Context, keepId: Int) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.activeNotifications
            .filter { it.packageName == context.packageName && it.id != keepId }
            .filter { it.notification.channelId == LIVE_CHANNEL_ID }
            .forEach { nm.cancel(it.id) }
    }

    /** 关闭提醒或退出账户时，同时清理已投递课程的通知与阶段闹钟。 */
    fun cancelAll(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.BAKLAVA) return
        val nm = context.getSystemService(NotificationManager::class.java)
        for (active in nm.activeNotifications) {
            if (active.notification.channelId != LIVE_CHANNEL_ID) continue
            active.notification.extras.getString(EXTRA_ALARM_ID)?.let {
                cancelPhaseAlarms(context, it)
            }
            nm.cancel(active.id)
        }
        lastSignature.clear()
    }

    /** 原样保留教室名：楼栋缩写含义未完全确认，不做替换。 */
    private fun cleanRoom(classroom: String): String = classroom.trim()

    private fun progressStyle(context: Context, progress: Int): Notification.ProgressStyle =
        Notification.ProgressStyle()
            .setProgress(progress)
            .setProgressSegments(
                listOf(Notification.ProgressStyle.Segment(100).setColor(ACCENT_COLOR))
            )
            .setProgressTrackerIcon(
                android.graphics.drawable.Icon.createWithResource(context, R.drawable.ic_stat_class)
            )

    private fun openScheduleIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("ysuclient://schedule")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    internal fun findNextClass(context: Context, currentAlarmId: String, endedAt: Long): JSONObject? = try {
        val alarms = JSONArray(
            UnifiedCache.getString(context, UnifiedCache.KEY_CLASS_ALARMS, "[]")
        )
        val now = System.currentTimeMillis()
        var best: JSONObject? = null
        var bestStart = Long.MAX_VALUE
        for (i in 0 until alarms.length()) {
            val alarm = alarms.getJSONObject(i)
            if (alarm.optString("alarmId") == currentAlarmId ||
                !alarm.optBoolean("liveUpdateEnabled", false)) continue
            val start = ClassReminderService.startAt(alarm)
            val gap = start - endedAt
            val end = alarm.optLong("endAt", 0L)
            if (gap in 0..NEXT_CLASS_WINDOW_MS && end > start && end > now && start < bestStart) {
                best = alarm
                bestStart = start
            }
        }
        best
    } catch (e: Exception) {
        Log.w(TAG, "findNextClass failed", e)
        null
    }

    fun buildExtras(
        courseName: String,
        classroom: String,
        startAt: Long,
        endAt: Long,
        remindMinutes: Int,
        conflictCount: Int
    ): Bundle = Bundle().apply {
        putString(EXTRA_COURSE, courseName)
        putString(EXTRA_CLASSROOM, classroom)
        putLong(EXTRA_START_AT, startAt)
        putLong(EXTRA_END_AT, endAt)
        putInt(EXTRA_REMIND, remindMinutes)
        putInt(EXTRA_CONFLICT, conflictCount)
    }

    /** 取消某个课次的阶段闹钟（开课/下课/刷新）。 */
    fun cancelPhaseAlarms(context: Context, alarmId: String) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        for (action in listOf(ACTION_CLASS_STARTED, ACTION_CLASS_ENDED, ACTION_CLASS_TICK)) {
            val intent = Intent(context, ClassAlarmReceiver::class.java).apply {
                this.action = action
            }
            val pending = PendingIntent.getBroadcast(
                context,
                ("$action:$alarmId").hashCode(),
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (pending != null) {
                alarmManager.cancel(pending)
                pending.cancel()
            }
        }
    }

    private fun schedule(
        context: Context,
        action: String,
        alarmId: String,
        triggerAt: Long,
        extras: Bundle
    ) {
        val intent = Intent(context, ClassAlarmReceiver::class.java).apply {
            addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
            this.action = action
            putExtra(EXTRA_ALARM_ID, alarmId)
            putExtras(extras)
        }
        val pending = PendingIntent.getBroadcast(
            context,
            ("$action:$alarmId").hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // 上课/下课是关键节点，按系统闹钟投递；tick 只是刷新进度，允许宽松窗口。
        ClassAlarmScheduling.schedule(
            context = context,
            triggerAt = triggerAt,
            operation = pending,
            asAlarmClock = action != ACTION_CLASS_TICK,
        )
    }
}
