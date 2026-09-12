package com.youwenqwq.ysuclient.notify

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
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
            require(alarmId.isNotBlank() && alarmTime > 0L) { "Invalid class alarm" }
            require(alarmIds.add(alarmId)) { "Duplicate class alarm: $alarmId" }
            if (alarmTime > now) futureAlarms.put(alarm)
        }

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        cancelAllAlarms(context)
        UnifiedCache.putString(context, UnifiedCache.KEY_CLASS_ALARMS, futureAlarms.toString())

        try {
            var canUseExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                alarmManager.canScheduleExactAlarms()
            for (i in 0 until futureAlarms.length()) {
                val alarm = futureAlarms.getJSONObject(i)
                val alarmId = alarm.getString("alarmId")
                val alarmTime = alarm.getLong("alarmTime")
                val pendingIntent = PendingIntent.getBroadcast(
                    context,
                    alarmId.hashCode(),
                    alarmIntent(context, alarmId, alarmTime),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                if (canUseExact) {
                    try {
                        alarmManager.setExactAndAllowWhileIdle(
                            AlarmManager.RTC_WAKEUP,
                            alarmTime,
                            pendingIntent
                        )
                    } catch (e: SecurityException) {
                        // Exact-alarm access can be revoked between the check and scheduling.
                        canUseExact = false
                        Log.w(TAG, "Exact alarms unavailable; using inexact reminders", e)
                    }
                }
                if (!canUseExact) {
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        alarmTime,
                        pendingIntent
                    )
                }
                Log.d(TAG, "Scheduled alarm $alarmId at $alarmTime (exact=$canUseExact)")
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
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        for (i in 0 until alarms.length()) {
            val alarm = alarms.getJSONObject(i)
            val alarmId = alarm.getString("alarmId")
            val alarmTime = alarm.getLong("alarmTime")
            cancelAlarm(context, alarmManager, alarmId, alarmIntent(context, alarmId, alarmTime))
            // Cancel alarms created before intents acquired a collision-safe data URI.
            cancelAlarm(context, alarmManager, alarmId, Intent(context, ClassAlarmReceiver::class.java))
        }
        UnifiedCache.putString(context, UnifiedCache.KEY_CLASS_ALARMS, "[]")
        Log.d(TAG, "All alarms cancelled")
    }

    private fun alarmIntent(context: Context, alarmId: String, alarmTime: Long) =
        Intent(context, ClassAlarmReceiver::class.java).apply {
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
