package me.uwen.orahako.nativebridge

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * OS-level entry points of the host application.
 *
 * Capability modules never reference the app's Activity class or a concrete
 * scheme: they resolve the launcher activity through the package manager, and
 * build deep links from the scheme and route hosts selected by the host build
 * composition, so a capability module compiles against any host application.
 */
object NativeHostApp {

    /** Deep-link scheme selected by the host build composition. */
    fun deepLinkScheme(context: Context): String =
        context.getString(R.string.orahako_native_deep_link_scheme)

    /** Intent that brings the host app's launcher activity to the front. */
    fun launchIntent(context: Context): Intent {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: throw NativeCapabilityCompositionException(
                "Host application ${context.packageName} has no launcher activity"
            )
        return intent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        )
    }

    /** Deep-link URI for a route host selected by the host composition. */
    fun deepLink(context: Context, host: String, path: String? = null): Uri {
        require(host.isNotBlank()) { "Deep-link host must not be blank" }
        val builder = Uri.Builder()
            .scheme(deepLinkScheme(context))
            .authority(host)
        if (!path.isNullOrBlank()) builder.path(path.trimStart('/'))
        return builder.build()
    }

    /** VIEW intent for one of the host application's deep links. */
    fun deepLinkIntent(context: Context, host: String, path: String? = null): Intent =
        Intent(Intent.ACTION_VIEW, deepLink(context, host, path)).apply {
            setPackage(context.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

    /**
     * PendingIntent that opens the host app, optionally through a deep link.
     * Callers choose the request code so independent entry points never collide.
     */
    fun activityPendingIntent(
        context: Context,
        requestCode: Int = 0,
        deepLink: Uri? = null,
    ): PendingIntent {
        val intent = if (deepLink == null) {
            launchIntent(context)
        } else {
            Intent(Intent.ACTION_VIEW, deepLink).apply {
                setPackage(context.packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** Version name of the installed host package, used in outbound User-Agent strings. */
    @Suppress("DEPRECATION")
    fun versionName(context: Context): String = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
    }.getOrNull().orEmpty()
}
