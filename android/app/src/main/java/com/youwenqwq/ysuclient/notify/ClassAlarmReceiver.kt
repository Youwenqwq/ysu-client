package com.youwenqwq.ysuclient.notify

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.youwenqwq.ysuclient.cache.UnifiedCache
import org.json.JSONArray

class ClassAlarmReceiver : BroadcastReceiver() {
    companion object {
        const val TAG = "YsuClassAlarm"
        const val EXTRA_ALARM_ID = "alarm_id"
        const val EXTRA_ALARM_TIME = "alarm_time"
        const val ACTION_START = "com.youwenqwq.ysuclient.action.CLASS_LIVE_START"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val alarmId = intent.getStringExtra(EXTRA_ALARM_ID) ?: return
        try {
            synchronized(ClassAlarmManager) {
                val alarms = JSONArray(UnifiedCache.getString(context, UnifiedCache.KEY_CLASS_ALARMS, "[]"))
                val alarm = (0 until alarms.length()).asSequence()
                    .map { alarms.getJSONObject(it) }
                    .firstOrNull { it.optString("alarmId") == alarmId } ?: return
                val alarmTime = alarm.getLong("alarmTime")
                if (intent.hasExtra(EXTRA_ALARM_TIME) &&
                    intent.getLongExtra(EXTRA_ALARM_TIME, 0L) != alarmTime) return
                val live = alarm.optBoolean("liveUpdateEnabled", false) &&
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA
                val startAt = ClassReminderService.startAt(alarm)
                val endAt = alarm.optLong("endAt")
                val now = System.currentTimeMillis()
                when (intent.action) {
                    ACTION_START -> {
                        if (now >= ClassReminderService.expiryAt(alarm)) return
                        if (now < startAt) {
                            val pending = PendingIntent.getBroadcast(
                                context, alarmId.hashCode(),
                                ClassAlarmManager.alarmIntent(context, alarmId, alarmTime, atStart = true),
                                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                            )
                            ClassAlarmScheduling.schedule(context, startAt, pending, asAlarmClock = true)
                        } else ClassReminderService.start(context, alarm)
                    }
                    ClassLiveUpdate.ACTION_CLASS_STARTED,
                    ClassLiveUpdate.ACTION_CLASS_TICK,
                    ClassLiveUpdate.ACTION_CLASS_ENDED -> {
                        if (!live || endAt <= startAt ||
                            intent.getLongExtra(ClassLiveUpdate.EXTRA_START_AT, 0L) != startAt ||
                            intent.getLongExtra(ClassLiveUpdate.EXTRA_END_AT, 0L) != endAt) return
                        // The foreground timer owns boundaries while alive; fallback broadcasts
                        // must not race it into two end transitions.
                        if (ClassReminderService.isMonitoring(alarmId)) return
                        if (now >= endAt) {
                            ClassLiveUpdate.markEnded(context, alarmId, intent.extras ?: android.os.Bundle())
                            ClassReminderService.nextClass(context, alarmId, endAt)?.let {
                                ClassReminderService.start(context, it)
                            }
                        } else {
                            ClassReminderService.start(context, alarm)
                        }
                    }
                    else -> {
                        if (now >= startAt) return
                        if (now < alarmTime) {
                            val pending = PendingIntent.getBroadcast(
                                context, alarmId.hashCode(),
                                ClassAlarmManager.alarmIntent(context, alarmId, alarmTime),
                                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                            )
                            ClassAlarmScheduling.schedule(context, alarmTime, pending, asAlarmClock = true)
                            return
                        }
                        // Keep the receiver process eligible to run until the one-shot
                        // waveform ends; no foreground disclosure is needed before class.
                        if (ClassReminderService.sendReminder(context, alarm)) {
                            val pending = goAsync()
                            Handler(Looper.getMainLooper()).postDelayed({ pending.finish() }, 2_200L)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            ClassReminderService.reportFailure(context, e)
        }
    }
}
