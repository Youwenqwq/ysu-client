package com.youwenqwq.ysuclient.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.youwenqwq.ysuclient.MainActivity
import com.youwenqwq.ysuclient.R
import com.youwenqwq.ysuclient.cache.UnifiedCache
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

class ClassAlarmReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "YsuClassAlarm"
        const val CHANNEL_ID = "ysu_class_alarm_channel"
        const val EXTRA_ALARM_ID = "alarm_id"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val alarmId = intent.getStringExtra(EXTRA_ALARM_ID) ?: return
        Log.d(TAG, "Alarm triggered: $alarmId")

        try {
            val alarmsJson = UnifiedCache.getString(context, UnifiedCache.KEY_CLASS_ALARMS, "[]")
            val alarms = JSONArray(alarmsJson)
            var alarmConfig: JSONObject? = null

            for (i in 0 until alarms.length()) {
                val obj = alarms.getJSONObject(i)
                if (obj.optString("alarmId") == alarmId) {
                    alarmConfig = obj
                    break
                }
            }

            if (alarmConfig == null) {
                Log.w(TAG, "Alarm config not found for $alarmId")
                return
            }

            val courseName = alarmConfig.optString("courseName", context.getString(R.string.notify_fallback_alarm_course))
            val classroom = alarmConfig.optString("classroom", "")
            val startTime = alarmConfig.optString("startTime", "")
            val remindMinutes = alarmConfig.optInt("remindMinutes", 15)

            // Verify course is still in today's schedule
            val schedule = UnifiedCache.getCachedSchedule(context)
            val now = Calendar.getInstance()
            val currentWeekday = now.get(Calendar.DAY_OF_WEEK)
            val mappedWeekday = when (currentWeekday) {
                Calendar.MONDAY -> 1
                Calendar.TUESDAY -> 2
                Calendar.WEDNESDAY -> 3
                Calendar.THURSDAY -> 4
                Calendar.FRIDAY -> 5
                Calendar.SATURDAY -> 6
                Calendar.SUNDAY -> 7
                else -> 1
            }

            var courseStillValid = false
            for (i in 0 until schedule.length()) {
                val course = schedule.getJSONObject(i)
                if (course.optString("name") == courseName &&
                    course.optInt("week_day", 0) == mappedWeekday) {
                    courseStillValid = true
                    break
                }
            }

            if (!courseStillValid) {
                Log.d(TAG, "Course no longer in today's schedule, skipping notification")
                return
            }

            sendClassNotification(context, courseName, classroom, startTime, remindMinutes)

            // Remove triggered alarm from cache
            val updatedAlarms = JSONArray()
            for (i in 0 until alarms.length()) {
                val obj = alarms.getJSONObject(i)
                if (obj.optString("alarmId") != alarmId) {
                    updatedAlarms.put(obj)
                }
            }
            UnifiedCache.putString(context, UnifiedCache.KEY_CLASS_ALARMS, updatedAlarms.toString())

        } catch (e: Exception) {
            Log.e(TAG, "Error handling class alarm", e)
        }
    }

    private fun sendClassNotification(
        ctx: Context,
        courseName: String,
        classroom: String,
        startTime: String,
        remindMinutes: Int
    ) {
        createNotificationChannel(ctx)
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val content = when {
            classroom.isNotEmpty() && startTime.isNotEmpty() ->
                ctx.getString(R.string.class_alarm_text_classroom_time, remindMinutes, classroom, startTime)
            classroom.isNotEmpty() ->
                ctx.getString(R.string.class_alarm_text_classroom, remindMinutes, classroom)
            else ->
                ctx.getString(R.string.class_alarm_text, remindMinutes)
        }

        val openIntent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            ctx, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(courseName)
            .setContentText(content)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        nm.notify(System.currentTimeMillis().toInt(), notification)
    }

    private fun createNotificationChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            ctx.getString(R.string.class_alarm_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = ctx.getString(R.string.class_alarm_channel_desc)
        }
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }
}
