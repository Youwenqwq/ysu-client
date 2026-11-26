package me.uwen.orahako.widget

import android.appwidget.AppWidgetProvider
import me.uwen.orahako.nativebridge.NativeInvokeResult
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetsCapabilityTest {

    private class FakeController : WidgetsController {
        data class Update(
            val widgetIds: List<String>,
            val snapshot: JSONObject,
            val settings: JSONObject?,
        )

        private val widgetDeclarations = mutableListOf(
            declaration("clock", "widgets.community"),
            declaration("community.clock", "widgets.community"),
        )
        val updates = mutableListOf<Update>()
        val settingsUpdates = mutableListOf<Pair<List<String>, JSONObject>>()
        val clears = mutableListOf<List<String>?>()
        var refreshed: List<String>? = null
        var reconciled = 0
        var released = 0
        var pinned: String? = null
        var pinResult = true

        override fun declarations(): List<NativeWidgetDeclaration> = widgetDeclarations

        override fun update(widgetIds: List<String>, snapshot: JSONObject, settings: JSONObject?) {
            requireDeclared(widgetIds)
            updates.add(Update(widgetIds, snapshot, settings))
        }

        override fun updateSettings(widgetIds: List<String>, settings: JSONObject) {
            requireDeclared(widgetIds)
            settingsUpdates.add(widgetIds to settings)
        }

        override fun clear(widgetIds: List<String>?) {
            widgetIds?.let(::requireDeclared)
            clears.add(widgetIds)
        }

        override fun refresh(widgetIds: List<String>?) {
            refreshed = widgetIds
        }

        override fun reconcile() {
            reconciled += 1
        }

        override fun requestPin(widgetId: String, onResult: (Boolean) -> Unit) {
            requireDeclared(listOf(widgetId))
            pinned = widgetId
            onResult(pinResult)
        }

        override fun release() {
            released += 1
        }

        private fun requireDeclared(widgetIds: List<String>) {
            for (widgetId in widgetIds) {
                if (widgetDeclarations.none { it.id == widgetId }) {
                    throw UnknownNativeWidgetException(widgetId)
                }
            }
        }
    }

    private data class Invocation(val value: Any?, val error: String?)

    private fun invoke(
        controller: WidgetsController,
        method: String,
        payload: Map<String, Any?> = emptyMap(),
    ): Invocation {
        var value: Any? = null
        var error: String? = null
        WidgetsCapability(emptyMap(), controller).bind().invoke(
            method,
            payload,
            object : NativeInvokeResult {
                override fun resolve(result: Any?) {
                    value = result
                }

                override fun reject(message: String, cause: Throwable?) {
                    error = message
                }
            },
        )
        return Invocation(value, error)
    }

    @Test
    fun updateDispatchesOpenStringWidgetIdsWithoutAnOfficialSwitch() {
        val controller = FakeController()

        val invocation = invoke(
            controller,
            "update",
            mapOf(
                "widget" to "community.clock",
                "snapshot" to mapOf("lines" to listOf("A", "B")),
                "settings" to mapOf("refreshMinutes" to 5),
            ),
        )

        assertNull(invocation.error)
        assertEquals(1, controller.updates.size)
        val update = controller.updates.single()
        assertEquals(listOf("community.clock"), update.widgetIds)
        assertEquals(2, update.snapshot.getJSONArray("lines").length())
        assertEquals(5, update.settings?.getInt("refreshMinutes"))
    }

    @Test
    fun unknownWidgetIdFailsDeterministically() {
        val invocation = invoke(
            FakeController(),
            "update",
            mapOf("widget" to "unowned", "snapshot" to mapOf("lines" to emptyList<String>())),
        )

        assertEquals("Unknown native widget: unowned", invocation.error)
    }

    @Test
    fun settingsWithoutWidgetTargetsEveryDeclaredWidget() {
        val controller = FakeController()

        val invocation = invoke(
            controller,
            "settings",
            mapOf("settings" to mapOf("refreshMinutes" to 15)),
        )

        assertNull(invocation.error)
        assertEquals(listOf("clock", "community.clock"), controller.settingsUpdates.single().first)
    }

    @Test
    fun clearWithoutWidgetClearsEveryWidget() {
        val controller = FakeController()

        val invocation = invoke(controller, "clear")

        assertNull(invocation.error)
        assertEquals(listOf(null), controller.clears)
    }

    @Test
    fun listReportsOpenWidgetIdsAndOwningCapabilities() {
        val invocation = invoke(FakeController(), "list")

        @Suppress("UNCHECKED_CAST")
        val result = invocation.value as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val widgets = result["widgets"] as List<Map<String, Any?>>
        assertEquals(listOf("clock", "community.clock"), widgets.map { it["id"] })
        assertEquals("widgets.community", widgets.first()["capability"])
    }

    @Test
    fun pinDelegatesToTheControllerAndSettlesLater() {
        val controller = FakeController()

        val invocation = invoke(controller, "pin", mapOf("widget" to "community.clock"))

        assertNull(invocation.error)
        assertEquals("community.clock", controller.pinned)
        assertEquals(mapOf("added" to true), invocation.value)
    }

    @Test
    fun invalidPayloadsAreRejectedInsteadOfThrowing() {
        val controller = FakeController()

        assertEquals(
            "Missing 'widget'",
            invoke(controller, "update", mapOf("snapshot" to mapOf("a" to 1))).error,
        )
        assertEquals(
            "Missing 'snapshot'",
            invoke(controller, "update", mapOf("widget" to "clock")).error,
        )
        assertEquals(
            "'snapshot' must be an object",
            invoke(controller, "update", mapOf("widget" to "clock", "snapshot" to "text")).error,
        )
        assertEquals("Missing 'settings'", invoke(controller, "settings").error)
    }

    @Test
    fun reconcileAndReleaseUseTheControllerLifecycle() {
        val controller = FakeController()
        val capability = WidgetsCapability(emptyMap(), controller)
        val binding = capability.bind()

        var settled = false
        binding.invoke(
            "reconcile",
            emptyMap(),
            object : NativeInvokeResult {
                override fun resolve(result: Any?) {
                    settled = true
                }

                override fun reject(message: String, cause: Throwable?) {
                    error(message)
                }
            },
        )
        binding.release()

        assertTrue(settled)
        assertEquals(1, controller.reconciled)
        assertEquals(1, controller.released)
    }

    companion object {
        private fun declaration(id: String, capabilityId: String): NativeWidgetDeclaration =
            NativeWidgetDeclaration(
                id = id,
                providerClass = AppWidgetProvider::class.java,
                renderer = NativeWidgetRenderer { _, _, _, _ -> },
                capabilityId = capabilityId,
            )
    }
}
