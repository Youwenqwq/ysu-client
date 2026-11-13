package me.uwen.orahako.notify

import android.content.Context
import android.util.Log
import me.uwen.orahako.cache.UnifiedCache

/**
 * Native provider boundary for background notification checks.
 *
 * Android must fetch academic data independently because the WebView/JS runtime is
 * not reliable in the background. Keep school-specific protocol code behind this
 * interface so NotifyWorker only coordinates sessions, diffing, cache updates, and
 * notifications.
 */
interface NativeAcademicProvider {
    val id: String

    fun establishSession(context: Context, authToken: String): Boolean

    fun fetchGrades(context: Context): FetchResult

    fun fetchExams(context: Context): FetchResult
}

object YsuNativeAcademicProvider : NativeAcademicProvider {
    override val id = "ysu"

    override fun establishSession(context: Context, authToken: String): Boolean {
        return NotifyHelper.establishSession(context, authToken)
    }

    override fun fetchGrades(context: Context): FetchResult {
        return NotifyHelper.fetchGrades(context)
    }

    override fun fetchExams(context: Context): FetchResult {
        return NotifyHelper.fetchExams(context)
    }
}

object NativeAcademicProviders {
    private const val TAG = "NativeProviders"

    fun active(context: Context): NativeAcademicProvider? {
        val providerId = UnifiedCache.getString(context, UnifiedCache.KEY_NOTIFY_PROVIDER_ID, "")
        return when (providerId) {
            "", YsuNativeAcademicProvider.id -> YsuNativeAcademicProvider
            else -> {
                Log.w(TAG, "No native academic provider registered for providerId=$providerId")
                null
            }
        }
    }
}
