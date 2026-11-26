package me.uwen.orahako.widget

import android.app.PendingIntent
import android.content.Context
import me.uwen.orahako.nativebridge.NativeHostApp

object WidgetConfig {

    /**
     * Creates a PendingIntent that opens the app at a route host supplied by the
     * widget companion. The scheme comes from the host build composition.
     */
    fun createDeepLinkPendingIntent(
        context: Context,
        appWidgetId: Int,
        host: String,
        path: String? = null,
    ): PendingIntent {
        val clickIntent = NativeHostApp.deepLinkIntent(context, host, path)
        return PendingIntent.getActivity(
            context,
            appWidgetId,
            clickIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
