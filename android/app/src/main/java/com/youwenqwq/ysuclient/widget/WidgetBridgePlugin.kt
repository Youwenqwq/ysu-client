package com.youwenqwq.ysuclient.widget

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.youwenqwq.ysuclient.cache.UnifiedCache
import org.json.JSONArray

@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridgePlugin : Plugin() {

    @PluginMethod
    fun syncSchedule(call: PluginCall) {
        val coursesJson = call.getString("coursesJson") ?: "[]"
        val currentWeekJson = call.getString("currentWeekJson") ?: ""
        val syncReminderHours = call.getInt("syncReminderHours", 24) ?: 24
        val showNextDaySchedule = call.getBoolean("showNextDaySchedule", false) ?: false

        UnifiedCache.saveCachedSchedule(context, JSONArray(coursesJson))
        UnifiedCache.saveCachedCurrentWeek(context, currentWeekJson)
        UnifiedCache.putInt(context, UnifiedCache.KEY_SYNC_REMINDER_HOURS, syncReminderHours)
        UnifiedCache.putBoolean(context, UnifiedCache.KEY_SHOW_NEXT_DAY_SCHEDULE, showNextDaySchedule)

        // Trigger all widget updates because settings and caches are shared
        updateAllWidgets()

        call.resolve()
    }

    @PluginMethod
    fun syncWidgetSettings(call: PluginCall) {
        val syncReminderHours = call.getInt("syncReminderHours", 24) ?: 24
        val showNextDaySchedule = call.getBoolean("showNextDaySchedule", false) ?: false

        UnifiedCache.putInt(context, UnifiedCache.KEY_SYNC_REMINDER_HOURS, syncReminderHours)
        UnifiedCache.putBoolean(context, UnifiedCache.KEY_SHOW_NEXT_DAY_SCHEDULE, showNextDaySchedule)

        // Trigger all widget updates so shared settings are reflected everywhere
        updateAllWidgets()
        call.resolve()
    }

    @PluginMethod
    fun syncExams(call: PluginCall) {
        val examsJson = call.getString("examsJson") ?: "[]"
        val syncReminderHours = call.getInt("syncReminderHours", 24) ?: 24

        UnifiedCache.saveCachedExams(context, JSONArray(examsJson))
        UnifiedCache.putInt(context, UnifiedCache.KEY_SYNC_REMINDER_HOURS, syncReminderHours)

        // Trigger all widget updates because settings and caches are shared
        updateAllWidgets()

        call.resolve()
    }
    @PluginMethod
    fun clearWidgetData(call: PluginCall) {
        UnifiedCache.clearWidgetData(context)
        updateAllWidgets()
        call.resolve()
    }

    private fun updateAllWidgets() {
        ScheduleWidgetHelper(context).updateAllWidgets()
        ExamWidgetHelper(context).updateAllWidgets()
    }
}
