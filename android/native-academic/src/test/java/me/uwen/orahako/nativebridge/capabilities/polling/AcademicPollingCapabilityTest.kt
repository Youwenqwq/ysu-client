package me.uwen.orahako.nativebridge.capabilities.polling

import android.app.Activity
import android.content.Context
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeCapabilityRegistry
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.nativebridge.NativeStateStore
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AcademicPollingCapabilityTest {

    private class UnusedHost : NativeCapabilityHost {
        override val context: Context
            get() = error("the polling scheduler must use injected seams in unit tests")
        override val activity: Activity?
            get() = null

        override fun hasPermission(permission: String): Boolean = error("unused")
        override fun requestPermissions(
            permissions: Array<String>,
            onResult: (Boolean) -> Unit,
        ) = error("unused")
        override fun runOnUiThread(action: () -> Unit) = error("unused")
        override fun evaluateJavascript(script: String) = error("unused")
        override fun emit(capabilityId: String, event: String, data: Map<String, Any?>) =
            error("unused")
    }

    private class InMemoryStateStore : NativeStateStore {
        private val values = LinkedHashMap<String, Any>()

        override fun getString(key: String, default: String): String =
            values[key] as? String ?: default

        override fun putString(key: String, value: String) {
            values[key] = value
        }

        override fun getBoolean(key: String, default: Boolean): Boolean =
            values[key] as? Boolean ?: default

        override fun putBoolean(key: String, value: Boolean) {
            values[key] = value
        }

        override fun getInt(key: String, default: Int): Int = values[key] as? Int ?: default

        override fun putInt(key: String, value: Int) {
            values[key] = value
        }

        override fun remove(key: String) {
            values.remove(key)
        }

        override fun keys(): Set<String> = values.keys.toSet()

        override fun clear() {
            values.clear()
        }
    }

    private class RecordingScheduler : BackgroundTaskScheduler {
        val periodic = mutableListOf<BackgroundTaskSpec>()
        val once = mutableListOf<BackgroundTaskSpec>()
        val cancelled = mutableListOf<String>()

        override fun schedulePeriodic(spec: BackgroundTaskSpec) {
            periodic += spec
        }

        override fun scheduleOnce(spec: BackgroundTaskSpec) {
            once += spec
        }

        override fun cancel(workName: String, tag: String) {
            cancelled += workName
        }
    }

    private class RecordingHandler(
        override val id: String,
        private val result: BackgroundTaskResult = BackgroundTaskResult.SUCCESS,
    ) : BackgroundTaskHandler {
        var runs = 0
        var cleared = 0

        override fun run(context: Context, payload: JSONObject): BackgroundTaskResult {
            runs++
            return result
        }

        override fun clear(context: Context) {
            cleared++
        }
    }

    private class CapturingResult : NativeInvokeResult {
        var value: Any? = null
        var error: String? = null

        override fun resolve(value: Any?) {
            this.value = value
        }

        override fun reject(message: String, cause: Throwable?) {
            error = message
        }
    }

    private val store = InMemoryStateStore()
    private val scheduler = RecordingScheduler()
    private val clearedHandlers = mutableListOf<String>()
    private val handler = RecordingHandler("demo")
    private val capability = AcademicPollingCapability(
        host = UnusedHost(),
        config = mapOf("minimumIntervalMinutes" to 15),
        storeOverride = store,
        schedulerOverride = scheduler,
        handlerClearOverride = { clearedHandlers += it },
    )
    private val binding = capability.bind()

    @After
    fun unregisterHandlers() {
        BackgroundTaskHandlers.clear()
    }

    private fun invoke(method: String, payload: Map<String, Any?> = emptyMap()): CapturingResult {
        val result = CapturingResult()
        binding.invoke(method, payload, result)
        return result
    }

    @Suppress("UNCHECKED_CAST")
    private fun CapturingResult.map(): Map<String, Any?> = value as Map<String, Any?>

    @Test
    fun configurePersistsAnOpaquePayloadAndClampsThePlatformMinimum() {
        BackgroundTaskHandlers.register(handler)

        val result = invoke(
            "configure",
            mapOf(
                "handlerId" to "demo",
                "intervalMinutes" to 5,
                "payload" to mapOf("session" to "token"),
            ),
        )

        assertEquals(15, result.map()["intervalMinutes"])
        val spec = scheduler.periodic.single()
        assertEquals("demo", spec.handlerId)
        assertEquals(15L, spec.intervalMinutes)
        assertEquals("orahako_polling:demo", spec.workName)
        assertEquals("token", JSONObject(spec.payloadJson).getString("session"))
        assertEquals(1, PollingTaskStore.loadAll(store).size)
    }

    @Test
    fun configureRejectsUnknownHandlersInsteadOfFallingBack() {
        val result = invoke("configure", mapOf("handlerId" to "ysu", "intervalMinutes" to 60))

        assertEquals("Unknown background task handler: ysu", result.error)
        assertTrue(scheduler.periodic.isEmpty())
        assertTrue(PollingTaskStore.loadAll(store).isEmpty())
    }

    @Test
    fun pauseCancelsWorkAndResumeRequeuesThePersistedInterval() {
        BackgroundTaskHandlers.register(handler)
        invoke("configure", mapOf("handlerId" to "demo", "intervalMinutes" to 30))

        val paused = invoke("pause", mapOf("handlerId" to "demo"))
        assertEquals(false, paused.map()["enabled"])
        assertEquals(listOf("orahako_polling:demo"), scheduler.cancelled)
        assertEquals(false, PollingTaskStore.loadAll(store).single().enabled)

        val resumed = invoke("resume", mapOf("handlerId" to "demo"))
        assertEquals(true, resumed.map()["enabled"])
        assertEquals(2, scheduler.periodic.size)
        assertEquals(30L, scheduler.periodic.last().intervalMinutes)
    }

    @Test
    fun stopCancelsWorkClearsNamespacedStateAndHandlerCache() {
        BackgroundTaskHandlers.register(handler)
        invoke("configure", mapOf("handlerId" to "demo", "intervalMinutes" to 60))

        val result = invoke("stop", mapOf("handlerId" to "demo"))

        assertEquals(listOf("demo"), result.map()["stopped"])
        assertEquals(listOf("orahako_polling:demo"), scheduler.cancelled)
        assertEquals(listOf("demo"), clearedHandlers)
        assertTrue(PollingTaskStore.loadAll(store).isEmpty())
    }

    @Test
    fun reconcileRequeuesOnlyEnabledTasksAndCancelsDisabledOnes() {
        BackgroundTaskHandlers.register(handler)
        invoke("configure", mapOf("handlerId" to "demo", "intervalMinutes" to 60))
        scheduler.periodic.clear()
        scheduler.cancelled.clear()

        capability.reconcile()
        assertEquals(listOf("orahako_polling:demo"), scheduler.periodic.map { it.workName })
        assertTrue(scheduler.cancelled.isEmpty())

        invoke("pause", mapOf("handlerId" to "demo"))
        scheduler.periodic.clear()
        scheduler.cancelled.clear()

        capability.reconcile()
        assertTrue(scheduler.periodic.isEmpty())
        assertEquals(listOf("orahako_polling:demo"), scheduler.cancelled)
    }

    @Test
    fun runNowQueuesOneWorkWithThePersistedPayload() {
        BackgroundTaskHandlers.register(handler)
        invoke(
            "configure",
            mapOf("handlerId" to "demo", "intervalMinutes" to 60, "payload" to mapOf("k" to "v")),
        )

        val result = invoke("runNow", mapOf("handlerId" to "demo"))

        assertEquals(true, result.map()["queued"])
        assertEquals("v", JSONObject(scheduler.once.single().payloadJson).getString("k"))
    }

    @Test
    fun transientLeaseReleaseKeepsThePersistedSchedule() {
        BackgroundTaskHandlers.register(handler)
        invoke("configure", mapOf("handlerId" to "demo", "intervalMinutes" to 60))

        binding.release()

        assertEquals(1, PollingTaskStore.loadAll(store).size)
        assertTrue(scheduler.cancelled.isEmpty())
    }

    @Test
    fun statusReportsPersistedTasksAndUnknownInspectIsRejected() {
        BackgroundTaskHandlers.register(handler)
        invoke("configure", mapOf("handlerId" to "demo", "intervalMinutes" to 45))

        @Suppress("UNCHECKED_CAST")
        val tasks = invoke("status").map()["tasks"] as List<Map<String, Any?>>
        assertEquals("demo", tasks.single()["handlerId"])
        assertEquals(45, tasks.single()["intervalMinutes"])

        val missing = invoke("inspect", mapOf("handlerId" to "ghost"))
        assertEquals("Unknown background task handler: ghost", missing.error)
        assertNull(missing.value)
    }

    @Test
    fun capabilityIsRegisteredWithItsVersionAndMethods() {
        val registry = NativeCapabilityRegistry(listOf(capability))
        val descriptor = registry.describe().single()
        assertEquals("academic.polling", descriptor.id)
        assertEquals(1, descriptor.version)
        assertEquals(
            listOf("configure", "inspect", "pause", "resume", "runNow", "status", "stop"),
            descriptor.methods,
        )
        try {
            registry.invoke(
                "academic.polling",
                "stop",
                mapOf("handlerId" to "demo"),
                CapturingResult(),
            )
        } catch (error: Exception) {
            fail("registry invocation failed: $error")
        }
    }
}
