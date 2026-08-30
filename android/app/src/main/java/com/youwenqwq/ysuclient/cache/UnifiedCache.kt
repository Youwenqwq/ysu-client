package com.youwenqwq.ysuclient.cache

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * 统一缓存层。所有原生端数据（Widget、通知、上课提醒）共享同一 SharedPreferences。
 *
 * 缓存格式：所有数据使用 JS 标准格式（即 api.ts 转换后的格式）。
 */
object UnifiedCache {
    private const val PREFS_NAME = "ysu_app_cache"

    // ─── Keys ───────────────────────────────────────────────────────────────

    const val KEY_SERVER_CONFIG = "server_config"
    const val KEY_CASTGC = "castgc"
    const val KEY_CACHED_SCHEDULE = "cached_schedule"
    const val KEY_CACHED_CURRENT_WEEK = "cached_current_week"
    const val KEY_CACHED_EXAMS = "cached_exams"
    const val KEY_CACHED_GRADES = "cached_grades"
    const val KEY_WIDGET_CACHED_EXAMS = "widget_cached_exams"
    const val KEY_NOTIFY_CACHED_EXAMS = "notify_cached_exams"
    const val KEY_NOTIFY_CACHED_GRADES = "notify_cached_grades"
    const val KEY_NOTIFY_GRADES_BASELINE_INITIALIZED = "notify_grades_baseline_initialized"
    const val KEY_NOTIFY_EXAMS_BASELINE_INITIALIZED = "notify_exams_baseline_initialized"
    const val KEY_NOTIFY_PROVIDER_ID = "notify_provider_id"
    const val KEY_NOTIFY_ACCOUNT_HASH = "notify_account_hash"
    const val KEY_NOTIFY_SCHEMA_VERSION = "notify_schema_version"
    const val KEY_NOTIFY_SETTINGS = "notify_settings"
    const val KEY_CLASS_ALARMS = "class_alarms"
    const val KEY_HAS_SYNCED_SCHEDULE = "has_synced_schedule"
    const val KEY_HAS_SYNCED_EXAMS = "has_synced_exams"
    const val KEY_LAST_SYNC_TIME = "last_sync_time"
    const val KEY_LAST_EXAM_SYNC_TIME = "last_exam_sync_time"
    const val KEY_SYNC_REMINDER_HOURS = "sync_reminder_hours"
    const val KEY_SHOW_NEXT_DAY_SCHEDULE = "show_next_day_schedule"

    // ─── Core helpers ───────────────────────────────────────────────────────

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun clearAll(context: Context) {
        prefs(context).edit().clear().apply()
    }
    /**
     * Clear data rendered by home-screen widgets without touching auth or
     * background-notification configuration.
     */
    fun clearWidgetData(context: Context) {
        prefs(context).edit()
            .remove(KEY_CACHED_SCHEDULE)
            .remove(KEY_CACHED_CURRENT_WEEK)
            .remove(KEY_CACHED_EXAMS)
            .remove(KEY_WIDGET_CACHED_EXAMS)
            .remove(KEY_HAS_SYNCED_SCHEDULE)
            .remove(KEY_HAS_SYNCED_EXAMS)
            .remove(KEY_LAST_SYNC_TIME)
            .remove(KEY_LAST_EXAM_SYNC_TIME)
            .apply()
    }


    fun remove(context: Context, key: String) {
        prefs(context).edit().remove(key).apply()
    }

    fun contains(context: Context, key: String): Boolean {
        return prefs(context).contains(key)
    }

    // ─── String / JSON ──────────────────────────────────────────────────────

    fun putString(context: Context, key: String, value: String) {
        prefs(context).edit().putString(key, value).apply()
    }

    fun getString(context: Context, key: String, default: String = ""): String =
        prefs(context).getString(key, default) ?: default

    fun putJsonObject(context: Context, key: String, obj: JSONObject) {
        putString(context, key, obj.toString())
    }

    fun getJsonObject(context: Context, key: String): JSONObject? {
        val str = getString(context, key, "")
        return if (str.isEmpty()) null else try {
            JSONObject(str)
        } catch (e: Exception) {
            android.util.Log.w("UnifiedCache", "Failed to parse JSON for key=$key", e)
            null
        }
    }

    fun putJsonArray(context: Context, key: String, arr: JSONArray) {
        putString(context, key, arr.toString())
    }

    fun getJsonArray(context: Context, key: String): JSONArray? {
        val str = getString(context, key, "")
        return if (str.isEmpty()) null else try {
            JSONArray(str)
        } catch (e: Exception) {
            android.util.Log.w("UnifiedCache", "Failed to parse JSON for key=$key", e)
            null
        }
    }

    // ─── Boolean / Int / Long ───────────────────────────────────────────────

    fun putBoolean(context: Context, key: String, value: Boolean) {
        prefs(context).edit().putBoolean(key, value).apply()
    }

    fun getBoolean(context: Context, key: String, default: Boolean = false): Boolean =
        prefs(context).getBoolean(key, default)

    fun putInt(context: Context, key: String, value: Int) {
        prefs(context).edit().putInt(key, value).apply()
    }

    fun getInt(context: Context, key: String, default: Int = 0): Int =
        prefs(context).getInt(key, default)

    fun putLong(context: Context, key: String, value: Long) {
        prefs(context).edit().putLong(key, value).apply()
    }

    fun getLong(context: Context, key: String, default: Long = 0L): Long =
        prefs(context).getLong(key, default)

    // ─── Convenience: cache arrays ──────────────────────────────────────────

    fun saveCachedGrades(context: Context, grades: JSONArray) {
        putJsonArray(context, KEY_CACHED_GRADES, grades)
    }

    /** Returns empty JSONArray if no grades cached. */
    fun getCachedGrades(context: Context): JSONArray {
        return getJsonArray(context, KEY_CACHED_GRADES) ?: JSONArray()
    }

    fun saveCachedExams(context: Context, exams: JSONArray) {
        val editor = prefs(context).edit()
        editor.putString(KEY_WIDGET_CACHED_EXAMS, exams.toString())
        editor.putBoolean(KEY_HAS_SYNCED_EXAMS, true)
        editor.putLong(KEY_LAST_EXAM_SYNC_TIME, System.currentTimeMillis())
        editor.apply()
    }

    /** Returns empty JSONArray if no widget exams cached. */
    fun getCachedExams(context: Context): JSONArray {
        return getJsonArray(context, KEY_WIDGET_CACHED_EXAMS)
            ?: getJsonArray(context, KEY_CACHED_EXAMS)
            ?: JSONArray()
    }

    fun saveCachedSchedule(context: Context, courses: JSONArray) {
        val editor = prefs(context).edit()
        editor.putString(KEY_CACHED_SCHEDULE, courses.toString())
        editor.putBoolean(KEY_HAS_SYNCED_SCHEDULE, true)
        editor.putLong(KEY_LAST_SYNC_TIME, System.currentTimeMillis())
        editor.apply()
    }

    /** Returns empty JSONArray if no schedule cached. */
    fun getCachedSchedule(context: Context): JSONArray {
        return getJsonArray(context, KEY_CACHED_SCHEDULE) ?: JSONArray()
    }

    fun saveCachedCurrentWeek(context: Context, weekJson: String) {
        putString(context, KEY_CACHED_CURRENT_WEEK, weekJson)
    }

    fun getCachedCurrentWeek(context: Context): String {
        return getString(context, KEY_CACHED_CURRENT_WEEK)
    }
}
