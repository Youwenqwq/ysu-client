package com.youwenqwq.ysuclient.notify

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.youwenqwq.ysuclient.cache.UnifiedCache
import org.json.JSONArray

object ClassAlarmManager {
    private const val TAG = "YsuClassAlarmManager"

    @Synchronized
    fun scheduleAlarms(context: Context, alarmsJson: String) {
        val alarms = JSONArray(alarmsJson)
        val futureAlarms = JSONArray()
        val alarmIds = HashSet<String>()
        val now = System.currentTimeMillis()
        // Validate before replacing the current configuration.
        for (i in 0 until alarms.length()) {
            val alarm = alarms.getJSONObject(i)
            val alarmId = alarm.getString("alarmId")
            val alarmTime = alarm.getLong("alarmTime")
            val expiresAt = ClassReminderService.expiryAt(alarm)
            require(alarmId.isNotBlank() && alarmTime > 0L) {
                "Invalid class alarm"
            }
            // 课表里同一门课同一天同一节可能有多条，跳过重复而不是让整批失败。
            if (!alarmIds.add(alarmId)) {
                Log.w(TAG, "Skipping duplicate class alarm: $alarmId")
                continue
            }
            // Keep active classes until the end so service restoration and a live
            // handoff can still resolve their saved configuration.
            if (expiresAt > now) futureAlarms.put(alarm)
        }

        cancelAllAlarms(context)
        UnifiedCache.putString(context, UnifiedCache.KEY_CLASS_ALARMS, futureAlarms.toString())

        try {
            for (i in 0 until futureAlarms.length()) {
                val alarm = futureAlarms.getJSONObject(i)
                val alarmId = alarm.getString("alarmId")
                val alarmTime = alarm.getLong("alarmTime")
                val startAt = ClassReminderService.startAt(alarm)
                // The reminder broadcast posts directly; only the separate start
                // broadcast may create a live-countdown foreground service.
                for (phase in 0..1) {
                    val atStart = phase == 1
                    if (!atStart && now >= startAt) continue
                    if (atStart && !alarm.optBoolean("liveUpdateEnabled", false)) continue
                    val pendingIntent = PendingIntent.getBroadcast(
                        context, alarmId.hashCode(),
                        alarmIntent(context, alarmId, alarmTime, atStart),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                    val triggerAt = if (atStart) startAt else alarmTime
                    val exact = ClassAlarmScheduling.schedule(
                        context, maxOf(now + 1_000L, triggerAt), pendingIntent, asAlarmClock = true
                    )
                    Log.d(TAG, "Scheduled alarm $alarmId at $triggerAt (start=$atStart, exact=$exact)")
                }
            }
        } catch (e: Exception) {
            // Do not report success or leave an untracked partially scheduled configuration.
            try {
                cancelAllAlarms(context)
            } catch (cleanupError: Exception) {
                e.addSuppressed(cleanupError)
            }
            throw e
        }
    }

    @Synchronized
    fun cancelAllAlarms(context: Context) {
        val alarms = JSONArray(UnifiedCache.getString(context, UnifiedCache.KEY_CLASS_ALARMS, "[]"))
        ClassReminderService.stop(context)
        ClassLiveUpdate.cancelAll(context)
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        for (i in 0 until alarms.length()) {
            val alarm = alarms.getJSONObject(i)
            val alarmId = alarm.getString("alarmId")
            val alarmTime = alarm.getLong("alarmTime")
            cancelAlarm(context, alarmManager, alarmId, alarmIntent(context, alarmId, alarmTime))
            cancelAlarm(context, alarmManager, alarmId, alarmIntent(context, alarmId, alarmTime, atStart = true))
            // Cancel alarms created before intents acquired a collision-safe data URI.
            cancelAlarm(context, alarmManager, alarmId, Intent(context, ClassAlarmReceiver::class.java))
            ClassLiveUpdate.cancelPhaseAlarms(context, alarmId)
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager)
                .cancel("class:$alarmId", 0)
        }
        UnifiedCache.putString(context, UnifiedCache.KEY_CLASS_ALARMS, "[]")
        Log.d(TAG, "All alarms cancelled")
    }

    internal fun alarmIntent(context: Context, alarmId: String, alarmTime: Long, atStart: Boolean = false) =
        Intent(context, ClassAlarmReceiver::class.java).apply {
            addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
            if (atStart) action = ClassAlarmReceiver.ACTION_START
            data = Uri.Builder()
                .scheme("ysuclient")
                .authority("class-alarm")
                .appendPath(alarmId)
                .appendPath(alarmTime.toString())
                .build()
            putExtra(ClassAlarmReceiver.EXTRA_ALARM_ID, alarmId)
            putExtra(ClassAlarmReceiver.EXTRA_ALARM_TIME, alarmTime)
        }

    private fun cancelAlarm(context: Context, manager: AlarmManager, alarmId: String, intent: Intent) {
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            alarmId.hashCode(),
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        ) ?: return
        manager.cancel(pendingIntent)
        pendingIntent.cancel()
    }
}
