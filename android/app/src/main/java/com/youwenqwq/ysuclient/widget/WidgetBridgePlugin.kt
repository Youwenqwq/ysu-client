package com.youwenqwq.ysuclient.widget

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridgePlugin : Plugin() {

    @PluginMethod
    fun syncSchedule(call: PluginCall) {
        val coursesJson = call.getString("coursesJson", "[]")
        val currentWeekJson = call.getString("currentWeekJson", "")
        val syncReminderHours = call.getInt("syncReminderHours", 24) ?: 24

        val prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, android.content.Context.MODE_PRIVATE)
        prefs.edit().apply {
            putString(WidgetConfig.KEY_COURSES, coursesJson)
            putString(WidgetConfig.KEY_CURRENT_WEEK, currentWeekJson)
            putBoolean(WidgetConfig.KEY_HAS_SYNCED_SCHEDULE, true)
            putLong(WidgetConfig.KEY_LAST_SYNC_TIME, System.currentTimeMillis())
            putInt(WidgetConfig.KEY_SYNC_REMINDER_HOURS, syncReminderHours)
            apply()
        }

        // Trigger schedule widget update
        val scheduleHelper = ScheduleWidgetHelper(context)
        scheduleHelper.updateAllWidgets()

        call.resolve()
    }

    @PluginMethod
    fun syncWidgetSettings(call: PluginCall) {
        val syncReminderHours = call.getInt("syncReminderHours", 24) ?: 24

        val prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, android.content.Context.MODE_PRIVATE)
        prefs.edit().apply {
            putInt(WidgetConfig.KEY_SYNC_REMINDER_HOURS, syncReminderHours)
            apply()
        }

        // Trigger schedule widget update so reminder text reflects new threshold
        val scheduleHelper = ScheduleWidgetHelper(context)
        scheduleHelper.updateAllWidgets()

        call.resolve()
    }

    @PluginMethod
    fun syncExams(call: PluginCall) {
        val examsJson = call.getString("examsJson", "[]")
        val syncReminderHours = call.getInt("syncReminderHours", 24) ?: 24

        val prefs = context.getSharedPreferences(WidgetConfig.PREFS_NAME, android.content.Context.MODE_PRIVATE)
        prefs.edit().apply {
            putString(WidgetConfig.KEY_EXAMS, examsJson)
            putBoolean(WidgetConfig.KEY_HAS_SYNCED_EXAMS, true)
            putLong(WidgetConfig.KEY_LAST_EXAM_SYNC_TIME, System.currentTimeMillis())
            putInt(WidgetConfig.KEY_SYNC_REMINDER_HOURS, syncReminderHours)
            apply()
        }

        // Trigger exam widget update
        val examHelper = ExamWidgetHelper(context)
        examHelper.updateAllWidgets()

        call.resolve()
    }
}
