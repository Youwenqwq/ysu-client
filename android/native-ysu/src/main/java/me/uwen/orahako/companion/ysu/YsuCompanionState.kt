package me.uwen.orahako.companion.ysu

import android.content.Context
import me.uwen.orahako.nativebridge.NativeCapabilityState
import me.uwen.orahako.nativebridge.NativeStateStore
import org.json.JSONArray
import org.json.JSONObject

/**
 * Persistent state owned by the YSU companion handler.
 *
 * Everything the background polling handler needs across process death lives
 * here under its own namespace: the session token, provider identity, baseline
 * flags and the last observed grade/exam snapshots. `clear` drops all of it
 * when polling is stopped or the account is removed.
 */
object YsuCompanionState {

    private const val NAMESPACE = "companion.ysu"
    private const val SCHEMA_VERSION = 2

    private const val KEY_CASTGC = "castgc"
    private const val KEY_SERVER_CONFIG = "server_config"
    private const val KEY_PROVIDER_ID = "provider_id"
    private const val KEY_ACCOUNT_HASH = "account_hash"
    private const val KEY_SCHEMA_VERSION = "schema_version"
    private const val KEY_GRADES_BASELINE = "grades_baseline"
    private const val KEY_EXAMS_BASELINE = "exams_baseline"
    private const val KEY_CACHED_GRADES = "cached_grades"
    private const val KEY_CACHED_EXAMS = "cached_exams"
    private const val KEY_SESSION_EXPIRED = "session_expired"
    private const val KEY_CONSECUTIVE_FAILURES = "consecutive_failures"

    fun store(context: Context): NativeStateStore = NativeCapabilityState(context, NAMESPACE)

    // ─── Session ────────────────────────────────────────────────────────────

    fun saveCastgc(context: Context, castgc: String) {
        store(context).putString(KEY_CASTGC, castgc)
    }

    fun castgc(context: Context): String? =
        store(context).getString(KEY_CASTGC, "").takeIf { it.isNotEmpty() }

    fun clearCastgc(context: Context) {
        store(context).remove(KEY_CASTGC)
    }

    fun setSessionExpired(context: Context, expired: Boolean) {
        store(context).putBoolean(KEY_SESSION_EXPIRED, expired)
    }

    fun isSessionExpired(context: Context): Boolean =
        store(context).getBoolean(KEY_SESSION_EXPIRED, false)

    // ─── Server configuration ───────────────────────────────────────────────

    fun saveServerConfig(context: Context, configJson: String) {
        store(context).putString(KEY_SERVER_CONFIG, configJson)
    }

    fun serverConfig(context: Context): JSONObject? {
        val raw = store(context).getString(KEY_SERVER_CONFIG, "")
        if (raw.isEmpty()) return null
        return runCatching { JSONObject(raw) }.getOrNull()
    }

    // ─── Provider identity & baselines ──────────────────────────────────────

    /**
     * Saves the active provider/account. Any identity or schema change resets
     * the diff baselines so a new account never inherits another's snapshot.
     */
    fun saveProviderIdentity(context: Context, providerId: String, accountHash: String) {
        val store = store(context)
        val previousProvider = store.getString(KEY_PROVIDER_ID, "")
        val previousHash = store.getString(KEY_ACCOUNT_HASH, "")
        val previousSchema = store.getInt(KEY_SCHEMA_VERSION, 0)
        if (previousSchema != SCHEMA_VERSION ||
            previousProvider != providerId ||
            previousHash != accountHash
        ) {
            resetBaselines(context)
        }
        store.putString(KEY_PROVIDER_ID, providerId)
        store.putString(KEY_ACCOUNT_HASH, accountHash)
        store.putInt(KEY_SCHEMA_VERSION, SCHEMA_VERSION)
    }

    fun ensureBaselineIdentity(context: Context): Boolean {
        val store = store(context)
        val ready = store.getInt(KEY_SCHEMA_VERSION, 0) == SCHEMA_VERSION &&
            store.getString(KEY_PROVIDER_ID, "").isNotEmpty() &&
            store.getString(KEY_ACCOUNT_HASH, "").isNotEmpty()
        if (!ready) resetBaselines(context)
        return ready
    }

    fun resetBaselines(context: Context) {
        val store = store(context)
        store.remove(KEY_CACHED_GRADES)
        store.remove(KEY_CACHED_EXAMS)
        store.putBoolean(KEY_GRADES_BASELINE, false)
        store.putBoolean(KEY_EXAMS_BASELINE, false)
    }

    fun isGradesBaselineInitialized(context: Context): Boolean =
        store(context).getBoolean(KEY_GRADES_BASELINE, false)

    fun isExamsBaselineInitialized(context: Context): Boolean =
        store(context).getBoolean(KEY_EXAMS_BASELINE, false)

    fun setGradesBaselineInitialized(context: Context, initialized: Boolean) {
        store(context).putBoolean(KEY_GRADES_BASELINE, initialized)
    }

    fun setExamsBaselineInitialized(context: Context, initialized: Boolean) {
        store(context).putBoolean(KEY_EXAMS_BASELINE, initialized)
    }

    // ─── Snapshots ──────────────────────────────────────────────────────────

    fun saveCachedGrades(context: Context, grades: List<JSONObject>) {
        store(context).putString(KEY_CACHED_GRADES, toJsonArray(grades).toString())
    }

    fun cachedGrades(context: Context): List<JSONObject> =
        parseArray(store(context).getString(KEY_CACHED_GRADES, "[]"))

    fun saveCachedExams(context: Context, exams: List<JSONObject>) {
        store(context).putString(KEY_CACHED_EXAMS, toJsonArray(exams).toString())
    }

    fun cachedExams(context: Context): List<JSONObject> =
        parseArray(store(context).getString(KEY_CACHED_EXAMS, "[]"))

    // ─── Failure tracking ───────────────────────────────────────────────────

    fun failures(context: Context): Int = store(context).getInt(KEY_CONSECUTIVE_FAILURES, 0)

    fun saveFailures(context: Context, count: Int) {
        store(context).putInt(KEY_CONSECUTIVE_FAILURES, count)
    }

    // ─── Diagnostics ────────────────────────────────────────────────────────

    fun snapshot(context: Context): Map<String, Any?> = mapOf(
        "providerId" to store(context).getString(KEY_PROVIDER_ID, ""),
        "hasSession" to (castgc(context) != null),
        "sessionExpired" to isSessionExpired(context),
        "gradesBaseline" to isGradesBaselineInitialized(context),
        "examsBaseline" to isExamsBaselineInitialized(context),
        "failures" to failures(context),
        "cachedGrades" to toJsonArray(cachedGrades(context)),
        "cachedExams" to toJsonArray(cachedExams(context)),
    )

    fun clear(context: Context) {
        store(context).clear()
    }

    private fun toJsonArray(items: List<JSONObject>): JSONArray {
        val array = JSONArray()
        for (item in items) array.put(item)
        return array
    }

    private fun parseArray(raw: String): List<JSONObject> = try {
        val array = JSONArray(raw)
        (0 until array.length()).mapNotNull { array.optJSONObject(it) }
    } catch (_: Exception) {
        emptyList()
    }
}
