package me.uwen.orahako.nativebridge.capabilities.polling

import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeCapabilityInitializer
import me.uwen.orahako.nativebridge.NativeCapabilityReconciler
import me.uwen.orahako.nativebridge.NativeCapabilityState
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.nativebridge.NativeStateStore
import me.uwen.orahako.nativebridge.kotlinValueToJson
import org.json.JSONObject

/**
 * Generic periodic work scheduler.
 *
 * The capability persists `handlerId` + interval + opaque payload, enqueues
 * uniquely named WorkManager work and cancels it on `stop`, `pause` or logout.
 * Adapter behaviour is supplied through [BackgroundTaskHandler]; the scheduler
 * itself knows nothing about academic endpoints, sessions or notification copy.
 */
class AcademicPollingCapability(
    private val host: NativeCapabilityHost,
    override val config: Map<String, Any?>,
    storeOverride: NativeStateStore? = null,
    schedulerOverride: BackgroundTaskScheduler? = null,
    handlerClearOverride: ((String) -> Unit)? = null,
) : NativeCapability, NativeCapabilityInitializer, NativeCapabilityReconciler {

    companion object {
        const val ID = "academic.polling"
        const val VERSION = 1

        private const val METHOD_CONFIGURE = "configure"
        private const val METHOD_PAUSE = "pause"
        private const val METHOD_RESUME = "resume"
        private const val METHOD_STOP = "stop"
        private const val METHOD_RUN_NOW = "runNow"
        private const val METHOD_STATUS = "status"
        private const val METHOD_INSPECT = "inspect"

        private const val PLATFORM_MINIMUM_INTERVAL_MINUTES = 15
    }

    override val id: String = ID
    override val version: Int = VERSION

    override val methods: Set<String> = setOf(
        METHOD_CONFIGURE,
        METHOD_PAUSE,
        METHOD_RESUME,
        METHOD_STOP,
        METHOD_RUN_NOW,
        METHOD_STATUS,
        METHOD_INSPECT,
    )

    private val minimumIntervalMinutes: Int =
        config.int("minimumIntervalMinutes", PLATFORM_MINIMUM_INTERVAL_MINUTES)
            .coerceAtLeast(PLATFORM_MINIMUM_INTERVAL_MINUTES)
    private val defaultIntervalMinutes: Int =
        config.int("defaultIntervalMinutes", 60).coerceAtLeast(minimumIntervalMinutes)
    private val workNamePrefix: String = config.string("workNamePrefix") ?: "orahako_polling"
    private val tagPrefix: String = config.string("tagPrefix") ?: workNamePrefix
    private val requiresNetwork: Boolean = config.boolean("requiresNetwork", true)

    private val stateStore: NativeStateStore by lazy {
        storeOverride ?: NativeCapabilityState(host.context, ID)
    }

    private val taskScheduler: BackgroundTaskScheduler by lazy {
        schedulerOverride ?: WorkManagerBackgroundTaskScheduler(host.context)
    }

    private val clearHandlerOverride: ((String) -> Unit)? = handlerClearOverride

    private val useDefaultHostContext: Boolean = storeOverride == null

    override fun initialize() {
        BackgroundTaskHandlers.prepareAll(host.context)
    }

    override fun bind(): NativeCapabilityBinding = Binding()

    override fun reconcile() {
        if (useDefaultHostContext) {
            BackgroundTaskHandlers.prepareAll(host.context)
        }
        for (task in PollingTaskStore.loadAll(stateStore)) {
            if (task.enabled) taskScheduler.schedulePeriodic(spec(task))
            else taskScheduler.cancel(workName(task.handlerId), tag(task.handlerId))
        }
    }

    private inner class Binding : NativeCapabilityBinding {
        override fun invoke(
            method: String,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            when (method) {
                METHOD_CONFIGURE -> configure(payload, result)
                METHOD_PAUSE -> setEnabled(payload, false, result)
                METHOD_RESUME -> setEnabled(payload, true, result)
                METHOD_STOP -> stop(payload, result)
                METHOD_RUN_NOW -> runNow(payload, result)
                METHOD_STATUS -> result.resolve(
                    mapOf(
                        "tasks" to PollingTaskStore.loadAll(stateStore).map { task ->
                            mapOf(
                                "handlerId" to task.handlerId,
                                "intervalMinutes" to task.intervalMinutes,
                                "enabled" to task.enabled,
                            )
                        }
                    )
                )
                METHOD_INSPECT -> inspect(payload, result)
            }
        }

        /** Scheduling is persisted desired state; a transient invoke lease must not clear it. */
        override fun release() = Unit
    }

    private fun configure(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val handlerId = payload.string("handlerId")
        if (handlerId == null) {
            result.reject("Missing handlerId")
            return
        }
        if (BackgroundTaskHandlers.find(handlerId) == null) {
            result.reject("Unknown background task handler: $handlerId")
            return
        }
        val interval = (payload["intervalMinutes"] as? Number)?.toInt()
            ?: defaultIntervalMinutes
        val task = PollingTask(
            handlerId = handlerId,
            intervalMinutes = interval.coerceAtLeast(minimumIntervalMinutes),
            enabled = true,
            payload = payload.objectValue("payload") ?: JSONObject(),
        )
        PollingTaskStore.save(stateStore, task)
        taskScheduler.schedulePeriodic(spec(task))
        result.resolve(
            mapOf(
                "handlerId" to task.handlerId,
                "intervalMinutes" to task.intervalMinutes,
                "scheduled" to true,
            )
        )
    }

    private fun setEnabled(
        payload: Map<String, Any?>,
        enabled: Boolean,
        result: NativeInvokeResult,
    ) {
        val handlerId = payload.string("handlerId")
        if (handlerId == null) {
            result.reject("Missing handlerId")
            return
        }
        val task = PollingTaskStore.load(stateStore, handlerId)
        if (task == null) {
            result.reject("No polling task configured for $handlerId")
            return
        }
        val updated = task.copy(enabled = enabled)
        PollingTaskStore.save(stateStore, updated)
        if (enabled) taskScheduler.schedulePeriodic(spec(updated))
        else taskScheduler.cancel(workName(handlerId), tag(handlerId))
        result.resolve(
            mapOf(
                "handlerId" to handlerId,
                "enabled" to enabled,
                "intervalMinutes" to updated.intervalMinutes,
            )
        )
    }

    private fun stop(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val requested = payload.string("handlerId")
        val handlerIds = requested?.let(::listOf) ?: PollingTaskStore.handlerIds(stateStore)
        for (handlerId in handlerIds) {
            taskScheduler.cancel(workName(handlerId), tag(handlerId))
            PollingTaskStore.remove(stateStore, handlerId)
            clearHandlerState(handlerId)
        }
        result.resolve(mapOf("stopped" to handlerIds))
    }

    private fun runNow(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val handlerId = payload.string("handlerId")
        if (handlerId == null) {
            result.reject("Missing handlerId")
            return
        }
        val task = PollingTaskStore.load(stateStore, handlerId)
        if (task == null) {
            result.reject("No polling task configured for $handlerId")
            return
        }
        taskScheduler.scheduleOnce(spec(task))
        result.resolve(mapOf("handlerId" to handlerId, "queued" to true))
    }

    private fun inspect(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val handlerId = payload.string("handlerId")
        if (handlerId == null) {
            result.reject("Missing handlerId")
            return
        }
        val handler = BackgroundTaskHandlers.find(handlerId)
        if (handler == null) {
            result.reject("Unknown background task handler: $handlerId")
            return
        }
        result.resolve(
            mapOf(
                "handlerId" to handlerId,
                "state" to handler.inspect(host.context),
            )
        )
    }

    private fun clearHandlerState(handlerId: String) {
        val clearer = clearHandlerOverride
        if (clearer != null) {
            clearer(handlerId)
            return
        }
        BackgroundTaskHandlers.find(handlerId)?.clear(host.context)
    }

    private fun spec(task: PollingTask) = BackgroundTaskSpec(
        handlerId = task.handlerId,
        workName = workName(task.handlerId),
        tag = tag(task.handlerId),
        intervalMinutes = task.intervalMinutes.toLong(),
        payloadJson = task.payload.toString(),
        requiresNetwork = requiresNetwork,
    )

    private fun workName(handlerId: String) = "$workNamePrefix:$handlerId"

    private fun tag(handlerId: String) = "$tagPrefix:$handlerId"
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
