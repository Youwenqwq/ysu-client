package me.uwen.orahako.widget.exam

import android.appwidget.AppWidgetProvider
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.widget.NativeWidgetDeclaration
import me.uwen.orahako.widget.NativeWidgetRenderer
import me.uwen.orahako.widget.WidgetsController
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ExamWidgetCompanionTest {

    private class RecordingController : WidgetsController {
        private val widgetDeclarations: List<NativeWidgetDeclaration> = listOf(
            declaration("exam"),
            declaration("exam-compact"),
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
    fun companionDeclaresOnlyExamWidgets() {
        assertEquals(
            listOf("exam", "exam-compact"),
            ExamWidgetComposition.declaredWidgets.map { it.id },
        )
        assertEquals(
            listOf(ExamWidgetsCapability.ID),
            ExamWidgetComposition.factories.keys.toList(),
        )
    }

    @Test
    fun examCompanionSyncsBothOwnedWidgetsAndKeepsSettingsSeparate() {
        val controller = RecordingController()
        val capability = ExamWidgetsCapability(emptyMap(), controller)

        assertNull(
            invoke(capability, "sync", mapOf("snapshot" to mapOf("exams" to emptyList<Any>())))
        )
        assertNull(
            invoke(capability, "settings", mapOf("settings" to mapOf("syncReminderHours" to 6)))
        )

        assertEquals(listOf("exam", "exam-compact"), controller.updates.single().first)
        assertEquals(listOf("exam", "exam-compact"), controller.settingsUpdates.single().first)
    }

    @Test
    fun companionClearOnlyTouchesItsOwnWidgets() {
        val controller = RecordingController()

        assertNull(invoke(ExamWidgetsCapability(emptyMap(), controller), "clear", emptyMap()))

        assertEquals(listOf(listOf("exam", "exam-compact")), controller.clears)
    }

    companion object {
        private fun declaration(id: String): NativeWidgetDeclaration =
            NativeWidgetDeclaration(
                id = id,
                providerClass = AppWidgetProvider::class.java,
                renderer = NativeWidgetRenderer { _, _, _, _ -> },
                capabilityId = ExamWidgetCompanion.CAPABILITY_ID,
            )
    }
}
