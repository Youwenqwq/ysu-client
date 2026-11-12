package com.youwenqwq.ysuclient.notify

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
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
        var live = false
        try {
            synchronized(ClassAlarmManager) {
                // The service removes ended courses from the cache. Terminal cleanup
                // instead validates the active notification's own deadline in onTick.
                if (intent.action == ClassLiveUpdate.ACTION_CLASS_TICK &&
                    intent.getLongExtra(ClassLiveUpdate.EXTRA_ENDED_DEADLINE, 0L) > 0L) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
                        live = true
                        ClassLiveUpdate.onTick(context, alarmId, intent.extras ?: android.os.Bundle())
                    }
                    return
                }
                val alarms = JSONArray(UnifiedCache.getString(context, UnifiedCache.KEY_CLASS_ALARMS, "[]"))
                val alarm = (0 until alarms.length()).asSequence()
                    .map { alarms.getJSONObject(it) }
                    .firstOrNull { it.optString("alarmId") == alarmId } ?: return
                val alarmTime = alarm.getLong("alarmTime")
                if (intent.hasExtra(EXTRA_ALARM_TIME) &&
                    intent.getLongExtra(EXTRA_ALARM_TIME, 0L) != alarmTime) return
                live = ClassAlarmManager.supportsLiveUpdate(context, alarm)
                val startAt = ClassReminderService.startAt(alarm)
                val endAt = alarm.optLong("endAt")
                val now = System.currentTimeMillis()
                when (intent.action) {
                    ACTION_START -> {
                        if (!live) return
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
                        if (!live && now < alarmTime) return
                        if (!live) {
                            val remaining = JSONArray()
                            for (i in 0 until alarms.length()) {
                                val saved = alarms.getJSONObject(i)
                                if (saved.optString("alarmId") != alarmId) remaining.put(saved)
                            }
                            UnifiedCache.putString(
                                context, UnifiedCache.KEY_CLASS_ALARMS, remaining.toString()
                            )
                        }
                        // A delayed ordinary reminder is consumed but never reposted
                        // once class has started, matching the upstream receiver.
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
            if (live) ClassReminderService.reportFailure(context, e)
            else Log.e(TAG, "Error handling class alarm", e)
        }
    }
}
