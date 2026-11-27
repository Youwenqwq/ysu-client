package me.uwen.orahako.nativebridge.capabilities.background

import android.content.Context
import me.uwen.orahako.nativebridge.NativeStateStore
import org.json.JSONObject
import java.io.File

private const val HEX_DIGITS = "0123456789abcdef"

private fun encodeTaskKeyPart(value: String): String {
    val bytes = value.toByteArray(Charsets.UTF_8)
    val encoded = StringBuilder(bytes.size * 2)
    for (byte in bytes) {
        val unsigned = byte.toInt() and 0xff
        encoded.append(HEX_DIGITS[unsigned ushr 4])
        encoded.append(HEX_DIGITS[unsigned and 0x0f])
    }
    return encoded.toString()
}

/** Stable, collision-free identity for one plugin-owned background task. */
data class BackgroundTaskKey(
    val pluginId: String,
    val taskId: String,
) {
    val storageKey: String = "${encodeTaskKeyPart(pluginId)}.${encodeTaskKeyPart(taskId)}"
}

/** Persisted desired state of one generic JS background task. */
data class BackgroundTaskRecord(
    val taskId: String,
    val pluginId: String,
    val intervalMinutes: Int,
    val enabled: Boolean,
    val requiresNetwork: Boolean,
    val timeoutMs: Long,
    val payload: JSONObject,
) {
    val key: BackgroundTaskKey get() = BackgroundTaskKey(pluginId, taskId)

    fun toJson(): JSONObject = JSONObject()
        .put("taskId", taskId)
        .put("pluginId", pluginId)
        .put("intervalMinutes", intervalMinutes)
        .put("enabled", enabled)
        .put("requiresNetwork", requiresNetwork)
        .put("timeoutMs", timeoutMs)
        .put("payload", payload)
}

interface BackgroundScriptStorage {
    fun saveScript(key: BackgroundTaskKey, script: String)
    fun loadScript(key: BackgroundTaskKey): String?
    fun deleteScript(key: BackgroundTaskKey)
}

class FileBackgroundScriptStorage(context: Context) : BackgroundScriptStorage {
    private val dir: File = File(context.applicationContext.filesDir, "orahako_bg_scripts")

    private fun fileFor(key: BackgroundTaskKey): File = File(dir, "${key.storageKey}.js")

    override fun saveScript(key: BackgroundTaskKey, script: String) {
        if (!dir.exists()) dir.mkdirs()
        val target = fileFor(key)
        val tmp = File(dir, "${target.name}.tmp")
        tmp.writeText(script, Charsets.UTF_8)
        if (!tmp.renameTo(target)) {
            target.writeText(script, Charsets.UTF_8)
            tmp.delete()
        }
    }

    override fun loadScript(key: BackgroundTaskKey): String? {
        val file = fileFor(key)
        return if (file.isFile) file.readText(Charsets.UTF_8) else null
    }

    override fun deleteScript(key: BackgroundTaskKey) {
        fileFor(key).delete()
    }
}

internal object BackgroundTaskStore {
    private const val TASK_PREFIX = "task:"
    private const val DIAG_PREFIX = "diag:"

    private fun taskKey(key: BackgroundTaskKey) = "$TASK_PREFIX${key.storageKey}"
    private fun diagKey(key: BackgroundTaskKey) = "$DIAG_PREFIX${key.storageKey}"

    fun load(store: NativeStateStore, key: BackgroundTaskKey): BackgroundTaskRecord? =
        parse(store.getString(taskKey(key), ""))

    fun loadAll(store: NativeStateStore): List<BackgroundTaskRecord> =
        store.keys()
            .filter { it.startsWith(TASK_PREFIX) }
            .sorted()
            .mapNotNull { parse(store.getString(it, "")) }

    fun loadByPlugin(store: NativeStateStore, pluginId: String): List<BackgroundTaskRecord> =
        loadAll(store).filter { it.pluginId == pluginId }

    fun save(store: NativeStateStore, task: BackgroundTaskRecord) {
        store.putString(taskKey(task.key), task.toJson().toString())
    }

    fun remove(store: NativeStateStore, key: BackgroundTaskKey) {
        store.remove(taskKey(key))
        store.remove(diagKey(key))
    }

    fun saveDiagnostics(store: NativeStateStore, key: BackgroundTaskKey, diagnosticsJson: String) {
        store.putString(diagKey(key), diagnosticsJson)
    }

    fun loadDiagnostics(store: NativeStateStore, key: BackgroundTaskKey): Map<String, Any?> {
        val raw = store.getString(diagKey(key), "")
        if (raw.isBlank()) return emptyMap()
        val obj = runCatching { JSONObject(raw) }.getOrNull() ?: return emptyMap()
        return jsonObjectToMap(obj)
    }

    private fun parse(raw: String): BackgroundTaskRecord? {
        if (raw.isBlank()) return null
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val taskId = json.optString("taskId", "")
        val pluginId = json.optString("pluginId", "")
        if (taskId.isBlank() || pluginId.isBlank()) return null
        return BackgroundTaskRecord(
            taskId = taskId,
            pluginId = pluginId,
            intervalMinutes = json.optInt("intervalMinutes", 60),
            enabled = json.optBoolean("enabled", true),
            requiresNetwork = json.optBoolean("requiresNetwork", true),
            timeoutMs = json.optLong("timeoutMs", BackgroundJsRuntime.DEFAULT_TIMEOUT_MS),
            payload = json.optJSONObject("payload") ?: JSONObject(),
        )
    }

    private fun jsonObjectToMap(obj: JSONObject): Map<String, Any?> {
        val map = LinkedHashMap<String, Any?>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val value = obj.opt(key)
            map[key] = when (value) {
                JSONObject.NULL, null -> null
                is JSONObject -> jsonObjectToMap(value)
                is org.json.JSONArray -> (0 until value.length()).map { idx ->
                    val item = value.opt(idx)
                    when (item) {
                        JSONObject.NULL, null -> null
                        is JSONObject -> jsonObjectToMap(item)
                        else -> item
                    }
                }
                else -> value
            }
        }
        return map
    }
}
