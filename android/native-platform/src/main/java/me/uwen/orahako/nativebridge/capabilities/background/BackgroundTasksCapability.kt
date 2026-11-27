package me.uwen.orahako.nativebridge.capabilities.background

import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeCapabilityReconciler
import me.uwen.orahako.nativebridge.NativeCapabilityState
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.nativebridge.NativeStateStore
import me.uwen.orahako.nativebridge.kotlinValueToJson
import org.json.JSONObject

/**
 * Generic QuickJS-backed periodic background task capability (`background.tasks@1`).
 *
 * Any official or community plugin can register a self-contained JS background
 * script and schedule periodic/one-shot WorkManager runs with isolated per-plugin
 * storage, HTTP, and local notifications — without adding Kotlin code.
 */
class BackgroundTasksCapability(
    private val host: NativeCapabilityHost,
    override val config: Map<String, Any?>,
    storeOverride: NativeStateStore? = null,
    scriptStorageOverride: BackgroundScriptStorage? = null,
    schedulerOverride: BackgroundWorkScheduler? = null,
    pluginStorageClearOverride: ((String) -> Unit)? = null,
) : NativeCapability, NativeCapabilityReconciler {

    companion object {
        const val ID = "background.tasks"
        const val VERSION = 1

        private const val METHOD_REGISTER = "register"
        private const val METHOD_UNREGISTER = "unregister"
        private const val METHOD_PAUSE = "pause"
        private const val METHOD_RESUME = "resume"
        private const val METHOD_RUN_NOW = "runNow"
        private const val METHOD_STATUS = "status"
        private const val METHOD_INSPECT = "inspect"
        private const val METHOD_CLEAR_PLUGIN = "clearPlugin"

        private const val PLATFORM_MINIMUM_INTERVAL_MINUTES = 15
    }

    override val id: String = ID
    override val version: Int = VERSION
    override val methods: Set<String> = setOf(
        METHOD_REGISTER,
        METHOD_UNREGISTER,
        METHOD_PAUSE,
        METHOD_RESUME,
        METHOD_RUN_NOW,
        METHOD_STATUS,
        METHOD_INSPECT,
        METHOD_CLEAR_PLUGIN,
    )

    private val minimumIntervalMinutes: Int =
        config.int("minimumIntervalMinutes", PLATFORM_MINIMUM_INTERVAL_MINUTES)
            .coerceAtLeast(PLATFORM_MINIMUM_INTERVAL_MINUTES)
    private val defaultIntervalMinutes: Int =
        config.int("defaultIntervalMinutes", 60).coerceAtLeast(minimumIntervalMinutes)
    private val workNamePrefix: String = config.string("workNamePrefix") ?: "orahako_bg_task"
    private val tagPrefix: String = config.string("tagPrefix") ?: workNamePrefix

    private val stateStore: NativeStateStore by lazy {
        storeOverride ?: NativeCapabilityState(host.context, ID)
    }
    private val scriptStorage: BackgroundScriptStorage by lazy {
        scriptStorageOverride ?: FileBackgroundScriptStorage(host.context)
    }
    private val scheduler: BackgroundWorkScheduler by lazy {
        schedulerOverride ?: WorkManagerBackgroundWorkScheduler(host.context)
    }
    private val clearPluginStorage: (String) -> Unit = pluginStorageClearOverride ?: { pluginId ->
        AndroidBackgroundHostBridge.clearPluginStorage(host.context, pluginId)
    }

    override fun bind(): NativeCapabilityBinding = Binding()

    override fun reconcile() {
        for (task in BackgroundTaskStore.loadAll(stateStore)) {
            if (task.enabled) scheduler.schedulePeriodic(scheduleSpec(task))
            else scheduler.cancel(workName(task.key), tag(task.key))
        }
    }

    private inner class Binding : NativeCapabilityBinding {
        override fun invoke(
            method: String,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            when (method) {
                METHOD_REGISTER -> register(payload, result)
                METHOD_UNREGISTER -> unregister(payload, result)
                METHOD_PAUSE -> setEnabled(payload, false, result)
                METHOD_RESUME -> setEnabled(payload, true, result)
                METHOD_RUN_NOW -> runNow(payload, result)
                METHOD_STATUS -> status(payload, result)
                METHOD_INSPECT -> inspect(payload, result)
                METHOD_CLEAR_PLUGIN -> clearPlugin(payload, result)
            }
        }

        override fun release() = Unit
    }

    private fun register(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val taskId = payload.string("taskId")
        val pluginId = payload.string("pluginId")
        val script = payload.string("script")
        if (taskId == null || pluginId == null || script == null) {
            result.reject("taskId, pluginId, and script are required")
            return
        }
        val interval = ((payload["intervalMinutes"] as? Number)?.toInt() ?: defaultIntervalMinutes)
            .coerceAtLeast(minimumIntervalMinutes)
        val requiresNetwork = payload.boolean("requiresNetwork", true)
        val timeoutMs = ((payload["timeoutMs"] as? Number)?.toLong()
            ?: BackgroundJsRuntime.DEFAULT_TIMEOUT_MS)
            .coerceIn(1_000L, BackgroundJsRuntime.MAX_TIMEOUT_MS)
        val taskPayload = payload.objectValue("payload") ?: JSONObject()

        val record = BackgroundTaskRecord(
            taskId = taskId,
            pluginId = pluginId,
            intervalMinutes = interval,
            enabled = true,
            requiresNetwork = requiresNetwork,
            timeoutMs = timeoutMs,
            payload = taskPayload,
        )
        scriptStorage.saveScript(record.key, script)
        BackgroundTaskStore.save(stateStore, record)
        scheduler.schedulePeriodic(scheduleSpec(record))
        result.resolve(
            mapOf(
                "taskId" to record.taskId,
                "pluginId" to record.pluginId,
                "intervalMinutes" to record.intervalMinutes,
                "scheduled" to true,
            ),
        )
    }

    private fun unregister(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val pluginId = payload.string("pluginId")
        if (pluginId == null) {
            result.reject("Missing pluginId")
            return
        }
        val requestedTaskId = payload.string("taskId")
        val keys = if (requestedTaskId != null) {
            listOf(BackgroundTaskKey(pluginId, requestedTaskId))
        } else {
            BackgroundTaskStore.loadByPlugin(stateStore, pluginId).map { it.key }
        }
        for (key in keys) {
            scheduler.cancel(workName(key), tag(key))
            scriptStorage.deleteScript(key)
            BackgroundTaskStore.remove(stateStore, key)
        }
        result.resolve(mapOf("unregistered" to keys.map { it.taskId }))
    }

    private fun setEnabled(
        payload: Map<String, Any?>,
        enabled: Boolean,
        result: NativeInvokeResult,
    ) {
        val taskId = payload.string("taskId")
        val pluginId = payload.string("pluginId")
        if (taskId == null || pluginId == null) {
            result.reject("taskId and pluginId are required")
            return
        }
        val key = BackgroundTaskKey(pluginId, taskId)
        val existing = BackgroundTaskStore.load(stateStore, key)
        if (existing == null) {
            result.reject("No background task registered for $pluginId/$taskId")
            return
        }
        val updated = existing.copy(enabled = enabled)
        BackgroundTaskStore.save(stateStore, updated)
        if (enabled) scheduler.schedulePeriodic(scheduleSpec(updated))
        else scheduler.cancel(workName(key), tag(key))
        result.resolve(
            mapOf(
                "taskId" to taskId,
                "pluginId" to pluginId,
                "enabled" to enabled,
                "intervalMinutes" to updated.intervalMinutes,
            ),
        )
    }

    private fun runNow(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val taskId = payload.string("taskId")
        val pluginId = payload.string("pluginId")
        if (taskId == null || pluginId == null) {
            result.reject("taskId and pluginId are required")
            return
        }
        val existing = BackgroundTaskStore.load(stateStore, BackgroundTaskKey(pluginId, taskId))
        if (existing == null) {
            result.reject("No background task registered for $pluginId/$taskId")
            return
        }
        scheduler.scheduleOnce(scheduleSpec(existing))
        result.resolve(mapOf("taskId" to taskId, "pluginId" to pluginId, "queued" to true))
    }

    private fun status(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val pluginId = payload.string("pluginId")
        if (pluginId == null) {
            result.reject("Missing pluginId")
            return
        }
        val tasks = BackgroundTaskStore.loadByPlugin(stateStore, pluginId).map { task ->
            mapOf(
                "taskId" to task.taskId,
                "pluginId" to task.pluginId,
                "intervalMinutes" to task.intervalMinutes,
                "enabled" to task.enabled,
                "requiresNetwork" to task.requiresNetwork,
            )
        }
        result.resolve(mapOf("tasks" to tasks))
    }

    private fun inspect(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val taskId = payload.string("taskId")
        val pluginId = payload.string("pluginId")
        if (taskId == null || pluginId == null) {
            result.reject("taskId and pluginId are required")
            return
        }
        val key = BackgroundTaskKey(pluginId, taskId)
        val diag = BackgroundTaskStore.loadDiagnostics(stateStore, key)
        result.resolve(mapOf("taskId" to taskId, "pluginId" to pluginId, "state" to diag))
    }

    private fun clearPlugin(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val pluginId = payload.string("pluginId")
        if (pluginId == null) {
            result.reject("Missing pluginId")
            return
        }
        val owned = BackgroundTaskStore.loadByPlugin(stateStore, pluginId)
        for (task in owned) {
            scheduler.cancel(workName(task.key), tag(task.key))
            scriptStorage.deleteScript(task.key)
            BackgroundTaskStore.remove(stateStore, task.key)
        }
        clearPluginStorage(pluginId)
        result.resolve(
            mapOf(
                "pluginId" to pluginId,
                "clearedTasks" to owned.map { it.taskId },
            ),
        )
    }

    private fun scheduleSpec(task: BackgroundTaskRecord) = BackgroundScheduleSpec(
        key = task.key,
        workName = workName(task.key),
        tag = tag(task.key),
        intervalMinutes = task.intervalMinutes.toLong(),
        requiresNetwork = task.requiresNetwork,
    )

    private fun workName(key: BackgroundTaskKey) = "$workNamePrefix:${key.storageKey}"
    private fun tag(key: BackgroundTaskKey) = "$tagPrefix:${key.storageKey}"
}

private fun Map<String, Any?>.string(key: String): String? =
    (this[key] as? String)?.takeIf { it.isNotBlank() }

private fun Map<String, Any?>.objectValue(key: String): JSONObject? = when (val value = this[key]) {
    is JSONObject -> value
    is Map<*, *> -> kotlinValueToJson(value) as? JSONObject
    is String -> runCatching { JSONObject(value) }.getOrNull()
    else -> null
}

private fun Map<String, Any?>.int(key: String, default: Int): Int =
    (this[key] as? Number)?.toInt() ?: default

private fun Map<String, Any?>.boolean(key: String, default: Boolean): Boolean =
    this[key] as? Boolean ?: default
