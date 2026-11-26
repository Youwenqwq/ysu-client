package me.uwen.orahako.nativebridge

import android.content.Context
import android.content.SharedPreferences

/**
 * Persistence seam for capability-owned state.
 *
 * Every capability keeps its own namespace so `clear` never touches another
 * capability's data. Tests substitute [NativeCapabilityState] with an
 * in-memory implementation instead of touching SharedPreferences.
 */
interface NativeStateStore {
    fun getString(key: String, default: String = ""): String
    fun putString(key: String, value: String)
    fun getBoolean(key: String, default: Boolean = false): Boolean
    fun putBoolean(key: String, value: Boolean)
    fun getInt(key: String, default: Int = 0): Int
    fun putInt(key: String, value: Int)
    fun remove(key: String)
    fun keys(): Set<String>
    fun clear()
}

/**
 * Namespaced SharedPreferences store owned by one capability or companion.
 *
 * Preferences are opened lazily so composing capabilities never reads the
 * filesystem (or a host context) before an invocation needs it.
 */
class NativeCapabilityState(
    private val context: Context,
    namespace: String,
) : NativeStateStore {

    private val preferencesName = "orahako_native_${namespace.replace('.', '_')}"

    private val preferences: SharedPreferences by lazy {
        context.applicationContext.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
    }

    override fun getString(key: String, default: String): String =
        preferences.getString(key, default) ?: default

    override fun putString(key: String, value: String) {
        preferences.edit().putString(key, value).apply()
    }

    override fun getBoolean(key: String, default: Boolean): Boolean =
        preferences.getBoolean(key, default)

    override fun putBoolean(key: String, value: Boolean) {
        preferences.edit().putBoolean(key, value).apply()
    }

    override fun getInt(key: String, default: Int): Int = preferences.getInt(key, default)

    override fun putInt(key: String, value: Int) {
        preferences.edit().putInt(key, value).apply()
    }

    override fun remove(key: String) {
        preferences.edit().remove(key).apply()
    }

    override fun keys(): Set<String> = preferences.all.keys.toSet()

    override fun clear() {
        preferences.edit().clear().apply()
    }
}
