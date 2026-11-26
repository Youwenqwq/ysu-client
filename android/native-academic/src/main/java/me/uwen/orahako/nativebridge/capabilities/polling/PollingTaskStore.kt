package me.uwen.orahako.nativebridge.capabilities.polling

import me.uwen.orahako.nativebridge.NativeStateStore
import org.json.JSONObject

/** Persisted desired state of one scheduled handler. */
internal data class PollingTask(
    val handlerId: String,
    val intervalMinutes: Int,
    val enabled: Boolean,
    val payload: JSONObject,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("handlerId", handlerId)
        .put("intervalMinutes", intervalMinutes)
        .put("enabled", enabled)
        .put("payload", payload)
}

internal object PollingTaskStore {
    private const val KEY_PREFIX = "task:"

    private fun key(handlerId: String) = "$KEY_PREFIX$handlerId"

    fun load(store: NativeStateStore, handlerId: String): PollingTask? =
        parse(store.getString(key(handlerId), ""))

    fun loadAll(store: NativeStateStore): List<PollingTask> =
        store.keys()
            .filter { it.startsWith(KEY_PREFIX) }
            .sorted()
            .mapNotNull { parse(store.getString(it, "")) }

    fun save(store: NativeStateStore, task: PollingTask) {
        store.putString(key(task.handlerId), task.toJson().toString())
    }

    fun remove(store: NativeStateStore, handlerId: String) {
        store.remove(key(handlerId))
    }

    /** Returns every handler id that currently owns a persisted task. */
    fun handlerIds(store: NativeStateStore): List<String> =
        store.keys()
            .filter { it.startsWith(KEY_PREFIX) }
            .map { it.removePrefix(KEY_PREFIX) }
            .sorted()

    private fun parse(raw: String): PollingTask? {
        if (raw.isBlank()) return null
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val handlerId = json.optString("handlerId", "")
        if (handlerId.isBlank()) return null
        return PollingTask(
            handlerId = handlerId,
            intervalMinutes = json.optInt("intervalMinutes", 60),
            enabled = json.optBoolean("enabled", true),
            payload = json.optJSONObject("payload") ?: JSONObject(),
        )
    }
}
