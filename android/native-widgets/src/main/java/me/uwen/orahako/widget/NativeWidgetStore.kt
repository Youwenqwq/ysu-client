package me.uwen.orahako.widget

import android.content.Context
import org.json.JSONObject

/** Persistence for declarative widget snapshots, keyed by open widget id. */
interface NativeWidgetStore {
    fun readState(widgetId: String): NativeWidgetState
    fun writeSnapshot(widgetId: String, snapshot: JSONObject, updatedAt: Long)
    fun writeSettings(widgetId: String, settings: JSONObject?)
    fun clear(widgetId: String)
    fun clearAll()
    fun storedWidgetIds(): Set<String>
}

class SharedPreferencesNativeWidgetStore(context: Context) : NativeWidgetStore {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun readState(widgetId: String): NativeWidgetState = NativeWidgetState(
        snapshot = readObject(KEY_SNAPSHOT + widgetId),
        settings = readObject(KEY_SETTINGS + widgetId),
        updatedAt = prefs.getLong(KEY_UPDATED + widgetId, 0L),
    )

    override fun writeSnapshot(widgetId: String, snapshot: JSONObject, updatedAt: Long) {
        check(widgetId.isNotBlank()) { "Widget id must not be blank" }
        prefs.edit()
            .putString(KEY_SNAPSHOT + widgetId, snapshot.toString())
            .putLong(KEY_UPDATED + widgetId, updatedAt)
            .apply()
    }

    override fun writeSettings(widgetId: String, settings: JSONObject?) {
        check(widgetId.isNotBlank()) { "Widget id must not be blank" }
        val editor = prefs.edit()
        if (settings == null) {
            editor.remove(KEY_SETTINGS + widgetId)
        } else {
            editor.putString(KEY_SETTINGS + widgetId, settings.toString())
        }
        editor.apply()
    }

    override fun clear(widgetId: String) {
        prefs.edit()
            .remove(KEY_SNAPSHOT + widgetId)
            .remove(KEY_SETTINGS + widgetId)
            .remove(KEY_UPDATED + widgetId)
            .apply()
    }

    override fun clearAll() {
        prefs.edit().clear().apply()
    }

    override fun storedWidgetIds(): Set<String> {
        val ids = LinkedHashSet<String>()
        for (key in prefs.all.keys) {
            when {
                key.startsWith(KEY_SNAPSHOT) -> ids.add(key.removePrefix(KEY_SNAPSHOT))
                key.startsWith(KEY_SETTINGS) -> ids.add(key.removePrefix(KEY_SETTINGS))
                key.startsWith(KEY_UPDATED) -> ids.add(key.removePrefix(KEY_UPDATED))
            }
        }
        return ids
    }

    private fun readObject(key: String): JSONObject? {
        val value = prefs.getString(key, "") ?: return null
        if (value.isEmpty()) return null
        return try {
            JSONObject(value)
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        const val PREFS_NAME = "orahako_widgets"
        private const val KEY_SNAPSHOT = "snapshot:"
        private const val KEY_SETTINGS = "settings:"
        private const val KEY_UPDATED = "updated:"
    }
}
