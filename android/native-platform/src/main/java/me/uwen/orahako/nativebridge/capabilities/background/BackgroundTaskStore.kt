package me.uwen.orahako.nativebridge.capabilities.background

import android.content.Context
import me.uwen.orahako.nativebridge.NativeStateStore
import org.json.JSONObject
import java.io.File

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
    fun saveScript(taskId: String, script: String)
    fun loadScript(taskId: String): String?
    fun deleteScript(taskId: String)
}

class FileBackgroundScriptStorage(context: Context) : BackgroundScriptStorage {
    private val dir: File = File(context.applicationContext.filesDir, "orahako_bg_scripts")

    private fun fileFor(taskId: String): File {
        val safe = taskId.replace(Regex("[^A-Za-z0-9._-]"), "_")
        return File(dir, "$safe.js")
    }

    override fun saveScript(taskId: String, script: String) {
        if (!dir.exists()) dir.mkdirs()
        val target = fileFor(taskId)
        val tmp = File(dir, "${target.name}.tmp")
        tmp.writeText(script, Charsets.UTF_8)
        if (!tmp.renameTo(target)) {
            target.writeText(script, Charsets.UTF_8)
            tmp.delete()
        }
    }

    override fun loadScript(taskId: String): String? {
        val file = fileFor(taskId)
        return if (file.isFile) file.readText(Charsets.UTF_8) else null
    }

    override fun deleteScript(taskId: String) {
        fileFor(taskId).delete()
    }
}

internal object BackgroundTaskStore {
    private const val TASK_PREFIX = "task:"
    private const val DIAG_PREFIX = "diag:"

    private fun taskKey(taskId: String) = "$TASK_PREFIX$taskId"
    private fun diagKey(taskId: String) = "$DIAG_PREFIX$taskId"

    fun load(store: NativeStateStore, taskId: String): BackgroundTaskRecord? =
        parse(store.getString(taskKey(taskId), ""))

    fun loadAll(store: NativeStateStore): List<BackgroundTaskRecord> =
        store.keys()
            .filter { it.startsWith(TASK_PREFIX) }
            .sorted()
            .mapNotNull { parse(store.getString(it, "")) }

    fun loadByPlugin(store: NativeStateStore, pluginId: String): List<BackgroundTaskRecord> =
        loadAll(store).filter { it.pluginId == pluginId }

    fun save(store: NativeStateStore, task: BackgroundTaskRecord) {
        store.putString(taskKey(task.taskId), task.toJson().toString())
    }

    fun remove(store: NativeStateStore, taskId: String) {
        store.remove(taskKey(taskId))
        store.remove(diagKey(taskId))
    }

    fun saveDiagnostics(store: NativeStateStore, taskId: String, diagnosticsJson: String) {
        store.putString(diagKey(taskId), diagnosticsJson)
    }

    fun loadDiagnostics(store: NativeStateStore, taskId: String): Map<String, Any?> {
        val raw = store.getString(diagKey(taskId), "")
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
