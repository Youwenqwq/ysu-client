package me.uwen.orahako.nativebridge.capabilities.notifications

import android.app.Notification
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

/**
 * Snapshot of an Android notification channel's actual OS-effective settings.
 * Allows plugins to detect when an OEM ROM or user has downgraded or blocked a channel.
 */
data class NotificationChannelStatus(
    val id: String,
    val exists: Boolean,
    val name: String? = null,
    val importance: Int? = null,
    val soundEnabled: Boolean? = null,
    val vibrationEnabled: Boolean? = null,
    val showBadge: Boolean? = null,
    val lockscreenVisibility: Int? = null,
    val blocked: Boolean = false,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "id" to id,
        "exists" to exists,
        "name" to name,
        "importance" to importance,
        "soundEnabled" to soundEnabled,
        "vibrationEnabled" to vibrationEnabled,
        "showBadge" to showBadge,
        "lockscreenVisibility" to lockscreenVisibility,
        "blocked" to blocked,
    )
}

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

    /** Inspects one channel's actual OS-effective state. */
    fun inspect(context: Context, channelId: String): NotificationChannelStatus {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return NotificationChannelStatus(id = channelId, exists = false)
        }
        val manager = context.getSystemService(NotificationManager::class.java)
            ?: return NotificationChannelStatus(id = channelId, exists = false)
        val channel = manager.getNotificationChannel(channelId)
            ?: return NotificationChannelStatus(id = channelId, exists = false)
        return toStatus(channel)
    }

    /** Inspects every notification channel currently registered for this app. */
    fun inspectAll(context: Context): List<NotificationChannelStatus> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return emptyList()
        val manager = context.getSystemService(NotificationManager::class.java) ?: return emptyList()
        return manager.notificationChannels.map(::toStatus)
    }

    private fun toStatus(channel: NotificationChannel): NotificationChannelStatus =
        NotificationChannelStatus(
            id = channel.id,
            exists = true,
            name = channel.name?.toString(),
            importance = channel.importance,
            soundEnabled = channel.sound != null,
            vibrationEnabled = channel.shouldVibrate(),
            showBadge = channel.canShowBadge(),
            lockscreenVisibility = channel.lockscreenVisibility,
            blocked = channel.importance == NotificationManager.IMPORTANCE_NONE,
        )
}

internal fun parseLockscreenVisibility(value: Any?): Int? = when (value) {
    is Number -> value.toInt()
    is String -> when (value.lowercase()) {
        "public" -> Notification.VISIBILITY_PUBLIC
        "private" -> Notification.VISIBILITY_PRIVATE
        "secret" -> Notification.VISIBILITY_SECRET
        else -> null
    }
    else -> null
}
