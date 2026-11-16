package me.uwen.orahako.notify

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import me.uwen.orahako.nativebridge.NativeHostApp
import me.uwen.orahako.nativebridge.capabilities.notifications.canScheduleExactAlarms

/**
 * 闹钟投递策略。
 *
 * 课前提醒和实际上课属于用户可见的课程闹钟，优先使用 setAlarmClock，避免普通
 * allow-while-idle 闹钟被省电策略批处理。Android 12+ 两者均受精确闹钟权限限制；
 * 不可使用时保留非精确提醒，但不能承诺准点。
 */
internal object ClassAlarmScheduling {

    fun canScheduleExact(context: Context): Boolean = canScheduleExactAlarms(context)

    /**
     * @param asAlarmClock 关键节点是否尝试系统闹钟（同样受精确闹钟权限限制）。
     * @return 是否以精确或闹钟方式排程。
     */
    fun schedule(
        context: Context,
        triggerAt: Long,
        operation: PendingIntent,
        asAlarmClock: Boolean,
    ): Boolean {
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return false


        if (asAlarmClock) {
            val showIntent = NativeHostApp.activityPendingIntent(context)
            try {
                alarmManager.setAlarmClock(
                    AlarmManager.AlarmClockInfo(triggerAt, showIntent),
                    operation,
                )
                return true
            } catch (_: SecurityException) {
                // 精确闹钟权限未授予或刚被撤销，继续使用非精确提醒。
            }
        }
        if (canScheduleExact(context)) {
            val scheduled = runCatching {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation)
                true
            }.getOrDefault(false)
            if (scheduled) return true
        }

        try {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation)
        } catch (error: SecurityException) {
            throw IllegalStateException("Class alarm scheduling is blocked by the system", error)
        }
        return false
    }
}
