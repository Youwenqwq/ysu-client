package com.youwenqwq.ysuclient.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.youwenqwq.ysuclient.cache.UnifiedCache
import org.json.JSONArray

@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridgePlugin : Plugin() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingPinCall: PluginCall? = null
    private var pendingPinProvider: ComponentName? = null
    private var pendingPinWidgetIds: IntArray? = null
    private var pinConfirmationStarted = false

    companion object {
        private const val TAG = "WidgetBridge"
    }

    override fun handleOnPause() {
        if (pendingPinCall != null) pinConfirmationStarted = true
        super.handleOnPause()
    }

    override fun handleOnResume() {
        if (pendingPinCall != null && pinConfirmationStarted) {
            val previousIds = pendingPinWidgetIds ?: intArrayOf()
            val provider = pendingPinProvider
            val added = provider?.let {
                val currentIds = AppWidgetManager.getInstance(context).getAppWidgetIds(it)
                currentIds.any { id -> !previousIds.contains(id) }
            } == true
            resolvePendingPin(added)
        }
        super.handleOnResume()
    }

    private fun resolvePendingPin(added: Boolean) {
        val call = pendingPinCall ?: return
        pendingPinCall = null
        pendingPinProvider = null
        pendingPinWidgetIds = null
        pinConfirmationStarted = false
        call.resolve(JSObject().put("added", added))
    }

    @PluginMethod
    fun pinWidget(call: PluginCall) {
        resolvePendingPin(false)
        val provider = when (call.getString("widget")) {
            "schedule" -> ScheduleWidgetProvider::class.java
            "tomorrow" -> TomorrowScheduleWidgetProvider::class.java
            "exam" -> ExamWidgetProvider::class.java
            "exam-compact" -> ExamWidget2x2Provider::class.java
            else -> {
                call.reject("Unknown widget type")
                return
            }
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve(JSObject().put("added", false))
            return
        }

        bridge.executeOnMainThread {
            try {
                val manager = AppWidgetManager.getInstance(context)
                val providerComponent = ComponentName(context, provider)
                val previousWidgetIds = manager.getAppWidgetIds(providerComponent)
                val supported = manager.isRequestPinAppWidgetSupported
                val requestAccepted = supported && manager.requestPinAppWidget(
                    providerComponent,
                    null,
                    null
                )
                if (!requestAccepted) {
                    call.resolve(JSObject().put("added", false))
                    return@executeOnMainThread
                }

                pendingPinCall = call
                pendingPinProvider = providerComponent
                pendingPinWidgetIds = previousWidgetIds
                pinConfirmationStarted = false
                mainHandler.postDelayed({
                    if (pendingPinCall === call && !pinConfirmationStarted) {
                        Log.w(TAG, "Launcher confirmation was not detected")
                        resolvePendingPin(false)
                    }
                }, 1200)
            } catch (e: Exception) {
                call.reject("Failed to request widget pin: ${e.message}", e)
            }
        }
    }

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
