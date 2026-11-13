package me.uwen.orahako.notify

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import me.uwen.orahako.MainActivity

/**
 * 闹钟投递策略。
 *
 * 课前提醒和实际上课属于用户可见的课程闹钟，优先使用 setAlarmClock，避免普通
 * allow-while-idle 闹钟被省电策略批处理。Android 12+ 两者均受精确闹钟权限限制；
 * 不可使用时保留非精确提醒，但不能承诺准点。
 */
internal object ClassAlarmScheduling {

    fun canScheduleExact(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return false
        return runCatching { alarmManager.canScheduleExactAlarms() }.getOrDefault(false)
    }

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
            val showIntent = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
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
