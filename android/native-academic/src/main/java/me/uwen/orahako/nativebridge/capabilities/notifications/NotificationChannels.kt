package me.uwen.orahako.nativebridge.capabilities.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.provider.Settings

/**
 * Declarative notification channel description. Channel names and
 * descriptions are resolved by the publisher, so this helper stays free of
 * app copy and business semantics.
 */
data class NotificationChannelSpec(
    val id: String,
    val name: String,
    val description: String = "",
    val importance: Int = NotificationManager.IMPORTANCE_DEFAULT,
    val sound: Boolean = true,
    val vibration: Boolean = true,
    val showBadge: Boolean = true,
    val lockscreenVisibility: Int? = null,
)

object NotificationChannels {

    /**
     * Creates the channel when it does not exist yet, or updates its localized
     * name/description while preserving user-modified importance, sound and vibration.
     *
     * @return true when the channel was created by this call.
     */
    fun ensure(context: Context, spec: NotificationChannelSpec): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        val created = manager.getNotificationChannel(spec.id) == null

        val channel = NotificationChannel(spec.id, spec.name, spec.importance).apply {
            description = spec.description
            enableVibration(spec.vibration)
            setShowBadge(spec.showBadge)
            if (spec.lockscreenVisibility != null) {
                lockscreenVisibility = spec.lockscreenVisibility
            }
            if (spec.sound) {
                setSound(
                    Settings.System.DEFAULT_NOTIFICATION_URI,
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
            } else {
                setSound(null, null)
            }
        }
        manager.createNotificationChannel(channel)
        return created
    }
}
