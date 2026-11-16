package me.uwen.orahako.notify

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat
import me.uwen.orahako.nativebridge.NativeHostApp
import me.uwen.orahako.nativebridge.capabilities.notifications.NotificationChannelSpec
import me.uwen.orahako.nativebridge.capabilities.notifications.NotificationChannels

/** Deep link that class reminders and Live Updates open. */
internal fun scheduleDeepLink(context: Context): android.net.Uri =
    NativeHostApp.deepLink(context, context.getString(R.string.orahako_academic_host_schedule))

/**
 * Notification presentation owned by `reminders.classes`: the class reminder
 * channel, the Live Update channel and the timer-failure error channel.
 */
internal object ClassReminderNotifications {

    const val REMINDER_CHANNEL_ID = "orahako_classes_v2"
    const val LIVE_CHANNEL_ID = "orahako_classes_live_v1"
    const val ERROR_CHANNEL_ID = "orahako_errors_v2"

    fun ensureChannels(context: Context) {
        NotificationChannels.ensure(
            context,
            NotificationChannelSpec(
                id = REMINDER_CHANNEL_ID,
                name = context.getString(R.string.class_alarm_channel_name),
                description = context.getString(R.string.class_alarm_channel_desc),
                importance = NotificationManager.IMPORTANCE_HIGH,
            ),
        )
        NotificationChannels.ensure(
            context,
            NotificationChannelSpec(
                id = LIVE_CHANNEL_ID,
                name = context.getString(R.string.class_alarm_channel_name),
                description = context.getString(R.string.class_alarm_channel_desc),
                importance = NotificationManager.IMPORTANCE_LOW,
                sound = false,
                vibration = false,
                showBadge = false,
            ),
        )
        NotificationChannels.ensure(
            context,
            NotificationChannelSpec(
                id = ERROR_CHANNEL_ID,
                name = context.getString(R.string.notify_errors_channel_name),
                description = context.getString(R.string.notify_errors_channel_desc),
                importance = NotificationManager.IMPORTANCE_LOW,
                sound = false,
                vibration = false,
            ),
        )
    }

    fun builder(context: Context): NotificationCompat.Builder {
        ensureChannels(context)
        return NotificationCompat.Builder(context, REMINDER_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(openScheduleIntent(context))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE)
    }

    fun errorBuilder(context: Context): NotificationCompat.Builder {
        ensureChannels(context)
        return NotificationCompat.Builder(context, ERROR_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentIntent(openScheduleIntent(context))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
    }

    /** Drops posted reminders when the capability is disabled or released. */
    fun cancelAll(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        for (active in manager.activeNotifications) {
            if (active.notification.channelId == REMINDER_CHANNEL_ID) manager.cancel(active.id)
        }
        ClassLiveUpdate.cancelAll(context)
    }

    private fun openScheduleIntent(context: Context): PendingIntent =
        NativeHostApp.activityPendingIntent(context, deepLink = scheduleDeepLink(context))
}
