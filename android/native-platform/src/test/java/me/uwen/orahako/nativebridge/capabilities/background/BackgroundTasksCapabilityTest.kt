package me.uwen.orahako.nativebridge.capabilities.background

import android.app.Activity
import android.content.Context
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeCapabilityRegistry
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.nativebridge.NativeStateStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class BackgroundTasksCapabilityTest {

    private class UnusedHost : NativeCapabilityHost {
        override val context: Context get() = error("unused in unit test")
        override val activity: Activity? get() = null
        override fun hasPermission(permission: String): Boolean = error("unused")
        override fun requestPermissions(permissions: Array<String>, onResult: (Boolean) -> Unit) = error("unused")
        override fun runOnUiThread(action: () -> Unit) = error("unused")
        override fun evaluateJavascript(script: String) = error("unused")
        override fun emit(capabilityId: String, event: String, data: Map<String, Any?>) = error("unused")
    }

    private class InMemoryStateStore : NativeStateStore {
        private val map = LinkedHashMap<String, Any>()
        override fun getString(key: String, default: String): String = map[key] as? String ?: default
        override fun putString(key: String, value: String) { map[key] = value }
        override fun getBoolean(key: String, default: Boolean): Boolean = map[key] as? Boolean ?: default
        override fun putBoolean(key: String, value: Boolean) { map[key] = value }
        override fun getInt(key: String, default: Int): Int = map[key] as? Int ?: default
        override fun putInt(key: String, value: Int) { map[key] = value }
        override fun remove(key: String) { map.remove(key) }
        override fun keys(): Set<String> = map.keys.toSet()
        override fun clear() { map.clear() }
    }

    private class InMemoryScriptStorage : BackgroundScriptStorage {
        val scripts = LinkedHashMap<BackgroundTaskKey, String>()
        override fun saveScript(key: BackgroundTaskKey, script: String) { scripts[key] = script }
        override fun loadScript(key: BackgroundTaskKey): String? = scripts[key]
        override fun deleteScript(key: BackgroundTaskKey) { scripts.remove(key) }
    }

    private class RecordingScheduler : BackgroundWorkScheduler {
        val periodic = mutableListOf<BackgroundScheduleSpec>()
        val once = mutableListOf<BackgroundScheduleSpec>()
        val cancelled = mutableListOf<String>()
        override fun schedulePeriodic(spec: BackgroundScheduleSpec) { periodic += spec }
        override fun scheduleOnce(spec: BackgroundScheduleSpec) { once += spec }
        override fun cancel(workName: String, tag: String) { cancelled += workName }
    }

    @Suppress("UNCHECKED_CAST")
    private fun invoke(
        registry: NativeCapabilityRegistry,
        method: String,
        payload: Map<String, Any?> = emptyMap(),
    ): Map<String, Any?> {
        var resolved: Map<String, Any?>? = null
        var rejected: String? = null
        registry.invoke(
            BackgroundTasksCapability.ID,
            method,
            payload,
            object : NativeInvokeResult {
                override fun resolve(value: Any?) { resolved = value as? Map<String, Any?> }
                override fun reject(message: String, cause: Throwable?) { rejected = message }
            },
        )
        if (rejected != null) fail("Expected resolve for $method but rejected: $rejected")
        return resolved ?: emptyMap()
    }

    @Test
    fun registersRunsPausesAndClearsTasksPerPlugin() {
        val store = InMemoryStateStore()
        val scripts = InMemoryScriptStorage()
        val scheduler = RecordingScheduler()
        val clearedPlugins = mutableListOf<String>()

        val capability = BackgroundTasksCapability(
            host = UnusedHost(),
            config = mapOf("minimumIntervalMinutes" to 15, "defaultIntervalMinutes" to 60),
            storeOverride = store,
            scriptStorageOverride = scripts,
            schedulerOverride = scheduler,
            pluginStorageClearOverride = { clearedPlugins += it },
        )
        val registry = NativeCapabilityRegistry(listOf(capability))

        val reg = invoke(
            registry,
            "register",
            mapOf(
                "taskId" to "ysu-poll",
                "pluginId" to "orahako.provider.ysu",
                "script" to "globalThis.__orahakoBackgroundTask = async () => 'success';",
                "intervalMinutes" to 5,
                "payload" to mapOf("checkGrades" to true),
            ),
        )
        val key = BackgroundTaskKey("orahako.provider.ysu", "ysu-poll")
        assertEquals(true, reg["scheduled"])
        assertEquals(15, reg["intervalMinutes"])
        assertEquals(1, scheduler.periodic.size)
        assertTrue(scripts.loadScript(key)!!.contains("__orahakoBackgroundTask"))

        invoke(registry, "runNow", mapOf("taskId" to "ysu-poll", "pluginId" to "orahako.provider.ysu"))
        assertEquals(1, scheduler.once.size)

        invoke(registry, "pause", mapOf("taskId" to "ysu-poll", "pluginId" to "orahako.provider.ysu"))
        assertEquals(1, scheduler.cancelled.size)

        invoke(registry, "resume", mapOf("taskId" to "ysu-poll", "pluginId" to "orahako.provider.ysu"))
        assertEquals(2, scheduler.periodic.size)

        val cleared = invoke(registry, "clearPlugin", mapOf("pluginId" to "orahako.provider.ysu"))
        assertEquals(listOf("ysu-poll"), cleared["clearedTasks"])
        assertEquals(listOf("orahako.provider.ysu"), clearedPlugins)
        assertNull(scripts.loadScript(key))
    }

    @Suppress("UNCHECKED_CAST")
    @Test
    fun isolatesSameTaskIdAcrossPlugins() {
        val store = InMemoryStateStore()
        val scripts = InMemoryScriptStorage()
        val scheduler = RecordingScheduler()
        val capability = BackgroundTasksCapability(
            host = UnusedHost(),
            config = emptyMap(),
            storeOverride = store,
            scriptStorageOverride = scripts,
            schedulerOverride = scheduler,
            pluginStorageClearOverride = {},
        )
        val registry = NativeCapabilityRegistry(listOf(capability))
        val pluginA = "community.alpha"
        val pluginB = "community.beta"
        val keyA = BackgroundTaskKey(pluginA, "shared")
        val keyB = BackgroundTaskKey(pluginB, "shared")

        for ((pluginId, script) in listOf(pluginA to "script-a", pluginB to "script-b")) {
            invoke(
                registry,
                "register",
                mapOf("taskId" to "shared", "pluginId" to pluginId, "script" to script),
            )
        }

        assertEquals("script-a", scripts.loadScript(keyA))
        assertEquals("script-b", scripts.loadScript(keyB))
        assertEquals(2, scheduler.periodic.map { it.workName }.toSet().size)

        invoke(registry, "pause", mapOf("taskId" to "shared", "pluginId" to pluginA))
        val tasksA = invoke(registry, "status", mapOf("pluginId" to pluginA))["tasks"]
            as List<Map<String, Any?>>
        val tasksB = invoke(registry, "status", mapOf("pluginId" to pluginB))["tasks"]
            as List<Map<String, Any?>>
        assertEquals(false, tasksA.single()["enabled"])
        assertEquals(true, tasksB.single()["enabled"])

        BackgroundTaskStore.saveDiagnostics(store, keyA, """{"owner":"a"}""")
        BackgroundTaskStore.saveDiagnostics(store, keyB, """{"owner":"b"}""")
        val diagA = invoke(
            registry,
            "inspect",
            mapOf("taskId" to "shared", "pluginId" to pluginA),
        )["state"] as Map<String, Any?>
        val diagB = invoke(
            registry,
            "inspect",
            mapOf("taskId" to "shared", "pluginId" to pluginB),
        )["state"] as Map<String, Any?>
        assertEquals("a", diagA["owner"])
        assertEquals("b", diagB["owner"])

        val removed = invoke(registry, "unregister", mapOf("pluginId" to pluginA))
        assertEquals(listOf("shared"), removed["unregistered"])
        assertNull(BackgroundTaskStore.load(store, keyA))
        assertNull(scripts.loadScript(keyA))
        assertEquals("script-b", scripts.loadScript(keyB))
        assertEquals(true, BackgroundTaskStore.load(store, keyB)?.enabled)
        assertTrue(scheduler.cancelled.none { it == scheduler.periodic[1].workName })
    }
}
