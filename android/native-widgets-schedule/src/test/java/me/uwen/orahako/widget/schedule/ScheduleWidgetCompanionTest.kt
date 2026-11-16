package me.uwen.orahako.widget.schedule

import android.appwidget.AppWidgetProvider
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.widget.NativeWidgetDeclaration
import me.uwen.orahako.widget.NativeWidgetRenderer
import me.uwen.orahako.widget.WidgetsController
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ScheduleWidgetCompanionTest {

    private class RecordingController : WidgetsController {
        private val widgetDeclarations: List<NativeWidgetDeclaration> = listOf(
            declaration("schedule"),
            declaration("tomorrow"),
        )
        val updates = mutableListOf<Triple<List<String>, JSONObject, JSONObject?>>()
        val settingsUpdates = mutableListOf<Pair<List<String>, JSONObject>>()
        val clears = mutableListOf<List<String>?>()

        override fun declarations(): List<NativeWidgetDeclaration> = widgetDeclarations

        override fun update(widgetIds: List<String>, snapshot: JSONObject, settings: JSONObject?) {
            updates.add(Triple(widgetIds, snapshot, settings))
        }

        override fun updateSettings(widgetIds: List<String>, settings: JSONObject) {
            settingsUpdates.add(widgetIds to settings)
        }

        override fun clear(widgetIds: List<String>?) {
            clears.add(widgetIds)
        }

        override fun refresh(widgetIds: List<String>?) = Unit
        override fun reconcile() = Unit
        override fun requestPin(widgetId: String, onResult: (Boolean) -> Unit) = onResult(false)
        override fun release() = Unit
    }

    private fun invoke(
        capability: me.uwen.orahako.nativebridge.NativeCapability,
        method: String,
        payload: Map<String, Any?>,
    ): String? {
        var error: String? = null
        capability.bind().invoke(
            method,
            payload,
            object : NativeInvokeResult {
                override fun resolve(result: Any?) = Unit
                override fun reject(message: String, cause: Throwable?) {
                    error = message
                }
            },
        )
        return error
    }

    @Test
    fun companionDeclaresOnlyScheduleWidgets() {
        assertEquals(
            listOf("schedule", "tomorrow"),
            ScheduleWidgetComposition.declaredWidgets.map { it.id },
        )
        assertEquals(
            listOf(ScheduleWidgetsCapability.ID),
            ScheduleWidgetComposition.factories.keys.toList(),
        )
    }

    @Test
    fun scheduleCompanionSyncsBothOwnedWidgetsWithOneSnapshot() {
        val controller = RecordingController()
        val capability = ScheduleWidgetsCapability(emptyMap(), controller)

        val error = invoke(
            capability,
            "sync",
            mapOf(
                "snapshot" to mapOf("courses" to emptyList<Any>(), "week" to null),
                "settings" to mapOf("syncReminderHours" to 12, "showNextDaySchedule" to true),
            ),
        )

        assertNull(error)
        val update = controller.updates.single()
        assertEquals(listOf("schedule", "tomorrow"), update.first)
        assertEquals(12, update.third?.getInt("syncReminderHours"))
        assertEquals(true, update.third?.getBoolean("showNextDaySchedule"))
    }

    @Test
    fun companionClearOnlyTouchesItsOwnWidgets() {
        val controller = RecordingController()

        assertNull(invoke(ScheduleWidgetsCapability(emptyMap(), controller), "clear", emptyMap()))

        assertEquals(listOf(listOf("schedule", "tomorrow")), controller.clears)
    }

    companion object {
        private fun declaration(id: String): NativeWidgetDeclaration =
            NativeWidgetDeclaration(
                id = id,
                providerClass = AppWidgetProvider::class.java,
                renderer = NativeWidgetRenderer { _, _, _, _ -> },
                capabilityId = ScheduleWidgetCompanion.CAPABILITY_ID,
            )
    }
}
