package com.youwenqwq.ysuclient.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import com.youwenqwq.ysuclient.MainActivity
import com.youwenqwq.ysuclient.R

enum class NotificationKind(
    internal val channelId: String,
    internal val nameResource: Int,
    internal val descriptionResource: Int,
    internal val destination: String
) {
    GRADES("ysu_grades_v2", R.string.notify_grades_channel_name, R.string.notify_grades_channel_desc, "grades"),
    EXAMS("ysu_exams_v2", R.string.notify_exams_channel_name, R.string.notify_exams_channel_desc, "exams"),
    CLASSES("ysu_classes_v2", R.string.class_alarm_channel_name, R.string.class_alarm_channel_desc, "schedule"),
    AUTH("ysu_auth_v2", R.string.notify_auth_channel_name, R.string.notify_auth_channel_desc, "settings"),
    ERRORS("ysu_errors_v2", R.string.notify_errors_channel_name, R.string.notify_errors_channel_desc, "settings")
}

object NativeNotifications {
    fun builder(context: Context, kind: NotificationKind): NotificationCompat.Builder {
        ensureChannel(context, kind)
        val openIntent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("ysuclient://${kind.destination}")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentIntent = PendingIntent.getActivity(
            context,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(context, kind.channelId)
            .setSmallIcon(
                if (kind == NotificationKind.AUTH || kind == NotificationKind.ERRORS) {
                    android.R.drawable.ic_dialog_alert
                } else {
                    android.R.drawable.ic_dialog_info
                }
            )
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setCategory(
                when (kind) {
                    NotificationKind.GRADES, NotificationKind.AUTH -> NotificationCompat.CATEGORY_STATUS
                    NotificationKind.EXAMS -> NotificationCompat.CATEGORY_EVENT
                    NotificationKind.CLASSES -> NotificationCompat.CATEGORY_REMINDER
                    NotificationKind.ERRORS -> NotificationCompat.CATEGORY_ERROR
                }
            )
            .setPriority(
                when (kind) {
                    NotificationKind.AUTH -> NotificationCompat.PRIORITY_DEFAULT
                    NotificationKind.ERRORS -> NotificationCompat.PRIORITY_LOW
                    else -> NotificationCompat.PRIORITY_HIGH
                }
            )
            .setDefaults(
                if (kind == NotificationKind.ERRORS) 0
                else NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE
            )
            .setOnlyAlertOnce(kind == NotificationKind.ERRORS)
    }

    private fun ensureChannel(context: Context, kind: NotificationKind) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Never recreate or overwrite a channel the user has already configured.
        if (manager.getNotificationChannel(kind.channelId) != null) return

        val importance = when (kind) {
            NotificationKind.AUTH -> NotificationManager.IMPORTANCE_DEFAULT
            NotificationKind.ERRORS -> NotificationManager.IMPORTANCE_LOW
            else -> NotificationManager.IMPORTANCE_HIGH
        }
        val legacy = manager.getNotificationChannel(
            if (kind == NotificationKind.CLASSES) "ysu_class_alarm_channel" else "ysu_notify_channel"
        )
        val legacyDefault = if (kind == NotificationKind.CLASSES) {
            NotificationManager.IMPORTANCE_HIGH
        } else {
            NotificationManager.IMPORTANCE_DEFAULT
        }
        val preserveImportance = legacy != null && (
            legacy.importance != legacyDefault ||
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && legacy.hasUserSetImportance())
            )
        val channel = NotificationChannel(
            kind.channelId,
            context.getString(kind.nameResource),
            if (preserveImportance) minOf(importance, legacy!!.importance) else importance
        ).apply {
            description = context.getString(kind.descriptionResource)
            val audible = kind != NotificationKind.ERRORS
            enableVibration(audible)
            setSound(
                if (audible) Settings.System.DEFAULT_NOTIFICATION_URI else null,
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            if (audible && legacy != null) {
                // Keep recognizable user overrides while upgrading the old silent-by-default vibration.
                val preserveSound = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    legacy.hasUserSetSound()
                } else {
                    legacy.sound != Settings.System.DEFAULT_NOTIFICATION_URI
                }
                if (preserveSound) {
                    setSound(legacy.sound, legacy.audioAttributes)
                }
                if (legacy.vibrationPattern != null) {
                    vibrationPattern = legacy.vibrationPattern
                    enableVibration(legacy.shouldVibrate())
                }
            }
        }
        // New per-purpose IDs split the former combined channel; legacy IDs stay untouched.
        // The system's channel settings, notification permission, ringer and DND still apply.
        manager.createNotificationChannel(channel)
    }
}
