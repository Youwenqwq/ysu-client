package com.youwenqwq.ysuclient.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.youwenqwq.ysuclient.BuildConfig

/**
 * 这个是调试构建专用的喵：通过 adb 调用真实的缓存、闹钟、服务与可选强震动链。
 *
 *   adb shell am broadcast -f 0x10000000 -n com.youwenqwq.ysuclient/.notify.DebugLiveUpdateReceiver \
 *       --ei schedule_seconds 20 --ei reminder_seconds 5 --ei duration_seconds 20 --ez live false --ez vibrate true
 *
 * 正式构建中该 Receiver 会直接返回，不产生任何通知（应该吧）
 */
class DebugLiveUpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!BuildConfig.DEBUG) return

        // preview=1：用缓存里的真实课程数据发一条预览（开始时间设为 5 分钟后）。
        if (intent.getIntExtra("preview", 0) == 1) {
            val cached = org.json.JSONArray(
                com.youwenqwq.ysuclient.cache.UnifiedCache.getString(
                    context,
                    com.youwenqwq.ysuclient.cache.UnifiedCache.KEY_CLASS_ALARMS,
                    "[]"
                )
            )
            if (cached.length() == 0) {
                Log.w("YsuDebugLiveUpdate", "preview: no cached alarms")
                return
            }
            val first = cached.getJSONObject(0)
            val realStart = ClassReminderService.startAt(first)
            val realEnd = first.optLong("endAt", 0L)
            val duration = if (realEnd > realStart) realEnd - realStart else 45 * 60_000L
            val startAt = System.currentTimeMillis() + 5 * 60_000L
            val ok = Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA &&
                ClassLiveUpdate.post(
                    context,
                    "preview-${System.currentTimeMillis()}",
                    first.optString("courseName"),
                    first.optString("classroom"),
                    first.optString("startTime"),
                    startAt,
                    first.optInt("remindMinutes", 15),
                    first.optInt("conflictCount", 1),
                    startAt + duration
                )
            Log.d("YsuDebugLiveUpdate", "preview posted=$ok for ${first.optString("courseName")}")
            return
        }

        // 传 schedule_seconds 时走真实的「写缓存 + 闹钟」路径，用于验证后台拉起。
        val scheduleSeconds = intent.getIntExtra("schedule_seconds", 0)
        if (scheduleSeconds > 0) {
            val now = System.currentTimeMillis()
            val startAt = now + scheduleSeconds * 1000L
            // Both values count from now, never add a hidden lead onto class start.
            val reminderSeconds = intent.getIntExtra("reminder_seconds", (scheduleSeconds - 15 * 60).coerceAtLeast(0))
                .coerceIn(0, scheduleSeconds - 1)
            val reminderAt = now + reminderSeconds * 1000L
            val durationMs = intent.getIntExtra("duration_seconds", 45 * 60).coerceAtLeast(1) * 1000L
            // 追加到现有课表闹钟，避免覆盖真实提醒。
            val alarms = org.json.JSONArray(
                com.youwenqwq.ysuclient.cache.UnifiedCache.getString(
                    context,
                    com.youwenqwq.ysuclient.cache.UnifiedCache.KEY_CLASS_ALARMS,
                    "[]"
                )
            )
            alarms.put(
                org.json.JSONObject()
                    .put("alarmId", "debug-sched-$startAt")
                    .put("alarmTime", reminderAt)
                    .put("startAt", startAt)
                    .put("courseName", intent.getStringExtra("course") ?: "调度测试课程")
                    .put("classroom", intent.getStringExtra("room") ?: "调度教室")
                    .put("startTime", java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
                        .format(java.util.Date(startAt)))
                    .put("remindMinutes", 15)
                    .put("endAt", if (intent.getBooleanExtra("unknown_end", false)) 0L else startAt + durationMs)
                    .put("liveUpdateEnabled", intent.getBooleanExtra("live", true))
                    .put("vibrationEnabled", intent.getBooleanExtra("vibrate", false))
            )
            if (intent.hasExtra("gap_seconds")) {
                val nextStart = startAt + durationMs + intent.getIntExtra("gap_seconds", 0) * 1000L
                alarms.put(
                    org.json.JSONObject()
                        .put("alarmId", "debug-next-$startAt")
                        .put("alarmTime", nextStart - (startAt - reminderAt))
                        .put("startAt", nextStart)
                        .put("remindMinutes", 15)
                        .put("courseName", "连堂测试课程")
                        .put("classroom", "下一节教室")
                        .put("endAt", nextStart + durationMs)
                        .put("liveUpdateEnabled", true)
                        .put("vibrationEnabled", false)
                )
            }
            ClassAlarmManager.scheduleAlarms(context, alarms.toString())
            Log.d("YsuDebugLiveUpdate", "scheduled class start in ${scheduleSeconds}s at $startAt")
            return
        }

        val startInMinutes = intent.getIntExtra("minutes", 2).coerceAtLeast(0)
        val durationMinutes = intent.getIntExtra("duration", 45).coerceAtLeast(1)
        val courseName = intent.getStringExtra("course")?.takeIf { it.isNotBlank() } ?: "测试课程"
        val classroom = intent.getStringExtra("room")?.takeIf { it.isNotBlank() } ?: "调试教室"
        val startAt = System.currentTimeMillis() + startInMinutes * 60_000L
        val startTime = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
            .format(java.util.Date(startAt))
        val posted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA &&
            ClassLiveUpdate.post(
                context,
                "debug-${System.currentTimeMillis()}",
                courseName,
                classroom,
                startTime,
                startAt,
                15,
                intent.getIntExtra("conflict", 1),
                startAt + durationMinutes * 60_000L
            )
        Log.d("YsuDebugLiveUpdate", "posted=$posted startInMinutes=$startInMinutes")
    }
}
