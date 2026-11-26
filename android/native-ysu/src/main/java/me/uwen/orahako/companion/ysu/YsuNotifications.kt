package me.uwen.orahako.companion.ysu

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat
import me.uwen.orahako.nativebridge.NativeHostApp
import me.uwen.orahako.nativebridge.capabilities.notifications.NotificationChannelSpec
import me.uwen.orahako.nativebridge.capabilities.notifications.NotificationChannels
import me.uwen.orahako.notify.R as AcademicR

/**
 * YSU notification presentation: channel copy, priority and the deep link each
 * notification opens. Only the companion publishes these channels; the generic
 * capability owns permissions and channel mechanics.
 */
enum class YsuNotificationKind(
    internal val channelId: String,
    internal val nameResource: Int,
    internal val descriptionResource: Int,
    internal val hostResource: Int,
    internal val importance: Int,
) {
    GRADES(
        "orahako_grades",
        R.string.notify_grades_channel_name,
        R.string.notify_grades_channel_desc,
        R.string.orahako_ysu_host_grades,
        NotificationManager.IMPORTANCE_HIGH,
    ),
    EXAMS(
        "orahako_exams",
        R.string.notify_exams_channel_name,
        R.string.notify_exams_channel_desc,
        R.string.orahako_ysu_host_exams,
        NotificationManager.IMPORTANCE_HIGH,
    ),
    AUTH(
        "orahako_auth",
        R.string.notify_auth_channel_name,
        R.string.notify_auth_channel_desc,
        R.string.orahako_ysu_host_settings,
        NotificationManager.IMPORTANCE_DEFAULT,
    ),
    ERRORS(
        "orahako_errors",
        AcademicR.string.notify_errors_channel_name,
        AcademicR.string.notify_errors_channel_desc,
        R.string.orahako_ysu_host_settings,
        NotificationManager.IMPORTANCE_LOW,
    ),
}

object YsuNotifications {

    /** Ensures every channel this companion publishes. */
    fun ensureChannels(context: Context) {
        for (kind in YsuNotificationKind.entries) ensureChannel(context, kind)
    }

    fun builder(context: Context, kind: YsuNotificationKind): NotificationCompat.Builder {
        ensureChannel(context, kind)
        val openIntent = NativeHostApp.deepLinkIntent(
            context,
            context.getString(kind.hostResource),
        )
        val contentIntent = PendingIntent.getActivity(
            context,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val silent = kind == YsuNotificationKind.ERRORS
        return NotificationCompat.Builder(context, kind.channelId)
            .setSmallIcon(
                if (kind == YsuNotificationKind.AUTH || silent) {
                    android.R.drawable.ic_dialog_alert
                } else {
                    android.R.drawable.ic_dialog_info
                }
            )
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setCategory(
                when (kind) {
                    YsuNotificationKind.GRADES, YsuNotificationKind.AUTH ->
                        NotificationCompat.CATEGORY_STATUS
                    YsuNotificationKind.EXAMS -> NotificationCompat.CATEGORY_EVENT
                    YsuNotificationKind.ERRORS -> NotificationCompat.CATEGORY_ERROR
                }
            )
            .setPriority(
                when (kind) {
                    YsuNotificationKind.AUTH -> NotificationCompat.PRIORITY_DEFAULT
                    YsuNotificationKind.ERRORS -> NotificationCompat.PRIORITY_LOW
                    else -> NotificationCompat.PRIORITY_HIGH
                }
            )
            .setDefaults(
                if (silent) 0
                else NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE
            )
            .setOnlyAlertOnce(silent)
    }

    private fun ensureChannel(context: Context, kind: YsuNotificationKind) {
        NotificationChannels.ensure(
            context,
            NotificationChannelSpec(
                id = kind.channelId,
                name = context.getString(kind.nameResource),
                description = context.getString(kind.descriptionResource),
                importance = kind.importance,
                sound = kind != YsuNotificationKind.ERRORS,
                vibration = kind != YsuNotificationKind.ERRORS,
            ),
        )
    }
}
