package me.uwen.orahako.nativebridge.capabilities.notifications

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeCapabilityInitializer
import me.uwen.orahako.nativebridge.NativeCapabilityReconciler
import me.uwen.orahako.nativebridge.NativeComposition
import me.uwen.orahako.nativebridge.NativeHostApp
import me.uwen.orahako.nativebridge.NativeInvokeResult
import java.util.concurrent.atomic.AtomicInteger

/**
 * Generic notification primitive for every plugin: permissions, channel
 * management & inspection, local notification publishing/cancellation, and the
 * system settings the app asks the user to open (notification channels, exact
 * alarms, battery optimization, auto-start).
 */
class NotificationsCoreCapability(
    private val host: NativeCapabilityHost,
    override val config: Map<String, Any?>,
) : NativeCapability, NativeCapabilityInitializer, NativeCapabilityReconciler {

    companion object {
        const val ID = "notifications.core"
        const val VERSION = 1

        /** Runtime permission owned by this capability; no core alias is involved. */
        private val NOTIFICATION_PERMISSIONS: Array<String> = arrayOf(
            Manifest.permission.POST_NOTIFICATIONS,
        )

        private const val METHOD_CHECK_PERMISSIONS = "checkPermissions"
        private const val METHOD_REQUEST_PERMISSIONS = "requestPermissions"
        private const val METHOD_CHECK_EXACT_ALARM = "checkExactAlarmPermission"
        private const val METHOD_REQUEST_EXACT_ALARM = "requestExactAlarmPermission"
        private const val METHOD_CHECK_BATTERY = "checkBatteryOptimization"
        private const val METHOD_REQUEST_BATTERY = "requestIgnoreBatteryOptimization"
        private const val METHOD_OPEN_AUTO_START = "openAutoStartSettings"
        private const val METHOD_OPEN_SETTINGS = "openNotificationSettings"
        private const val METHOD_ENSURE_CHANNEL = "ensureChannel"
        private const val METHOD_ENSURE_CHANNELS = "ensureChannels"
        private const val METHOD_GET_CHANNEL_STATUS = "getChannelStatus"
        private const val METHOD_POST = "post"
        private const val METHOD_CANCEL = "cancel"
        private const val METHOD_CANCEL_ALL = "cancelAll"

        private val nextNotificationId = AtomicInteger(50_000)
    }

    override val id: String = ID
    override val version: Int = VERSION

    override val methods: Set<String> = setOf(
        METHOD_CHECK_PERMISSIONS,
        METHOD_REQUEST_PERMISSIONS,
        METHOD_CHECK_EXACT_ALARM,
        METHOD_REQUEST_EXACT_ALARM,
        METHOD_CHECK_BATTERY,
        METHOD_REQUEST_BATTERY,
        METHOD_OPEN_AUTO_START,
        METHOD_OPEN_SETTINGS,
        METHOD_ENSURE_CHANNEL,
        METHOD_ENSURE_CHANNELS,
        METHOD_GET_CHANNEL_STATUS,
        METHOD_POST,
        METHOD_CANCEL,
        METHOD_CANCEL_ALL,
    )

    override fun initialize() {
        ensureConfiguredChannels()
    }

    override fun bind(): NativeCapabilityBinding {
        ensureConfiguredChannels()
        return Binding()
    }

    override fun reconcile() {
        ensureConfiguredChannels()
    }

    /**
     * Channels declared by the composition config (publishers still own their
     * own catalogs). Re-applied on startup, acquire and after reboot/update.
     */
    private fun ensureConfiguredChannels() {
        val channels = config["channels"] as? List<*> ?: return
        for (raw in channels) {
            val channel = raw as? Map<*, *> ?: continue
            val spec = parseChannelSpec(channel) ?: continue
            NotificationChannels.ensure(host.context, spec)
        }
    }

    private inner class Binding : NativeCapabilityBinding {
        override fun invoke(
            method: String,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            when (method) {
                METHOD_CHECK_PERMISSIONS -> result.resolve(
                    mapOf("granted" to notificationsGranted(host.context))
                )
                METHOD_REQUEST_PERMISSIONS -> requestPermissions(result)
                METHOD_CHECK_EXACT_ALARM -> result.resolve(
                    mapOf("granted" to canScheduleExactAlarms(host.context))
                )
                METHOD_REQUEST_EXACT_ALARM -> requestExactAlarmPermission(result)
                METHOD_CHECK_BATTERY -> result.resolve(
                    mapOf("ignored" to isIgnoringBatteryOptimizations(host.context))
                )
                METHOD_REQUEST_BATTERY -> requestIgnoreBatteryOptimization(result)
                METHOD_OPEN_AUTO_START -> openAutoStartSettings(result)
                METHOD_OPEN_SETTINGS -> openNotificationSettings(payload, result)
                METHOD_ENSURE_CHANNEL -> ensureChannel(payload, result)
                METHOD_ENSURE_CHANNELS -> ensureChannels(payload, result)
                METHOD_GET_CHANNEL_STATUS -> getChannelStatus(payload, result)
                METHOD_POST -> postNotification(payload, result)
                METHOD_CANCEL -> cancelNotification(payload, result)
                METHOD_CANCEL_ALL -> {
                    NotificationManagerCompat.from(host.context).cancelAll()
                    result.resolve(mapOf("cancelled" to true))
                }
            }
        }

        override fun release() = Unit
    }

    private fun requestPermissions(result: NativeInvokeResult) {
        val context = host.context
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            val granted = notificationsGranted(context)
            if (granted) NativeComposition.initialize(context)
            result.resolve(mapOf("granted" to granted))
            return
        }
        try {
            host.requestPermissions(NOTIFICATION_PERMISSIONS) {
                val granted = notificationsGranted(context)
                if (granted) NativeComposition.initialize(context)
                result.resolve(mapOf("granted" to granted))
            }
        } catch (_: Exception) {
            result.resolve(mapOf("granted" to notificationsGranted(context)))
        }
    }

    private fun requestExactAlarmPermission(result: NativeInvokeResult) {
        val context = host.context
        if (canScheduleExactAlarms(context)) {
            result.resolve(mapOf("granted" to true))
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            result.resolve(mapOf("granted" to true))
            return
        }
        try {
            context.startActivity(
                Intent(
                    Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:${context.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (error: Exception) {
            result.reject("Unable to open exact alarm settings", error)
            return
        }
        result.resolve(mapOf("granted" to false))
    }

    private fun requestIgnoreBatteryOptimization(result: NativeInvokeResult) {
        val context = host.context
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            !isIgnoringBatteryOptimizations(context)
        ) {
            try {
                context.startActivity(
                    Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:${context.packageName}"),
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (_: Exception) {
                openAppDetailsSettings(context)
            }
        }
        result.resolve(mapOf("ignored" to isIgnoringBatteryOptimizations(context)))
    }

    private fun openAutoStartSettings(result: NativeInvokeResult) {
        val context = host.context
        val candidates = listOf(
            Intent().setClassName(
                "com.oplus.battery",
                "com.oplus.startupapp.view.StartupAppListActivity",
            ),
            Intent("com.coloros.safecenter.permission.startup.StartupAppListActivity"),
            Intent("com.oppo.safe.permission.startup.StartupAppListActivity"),
            Intent("com.miui.permcenter.autostart.AutoStartManagementActivity"),
            Intent("com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
            Intent("com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
            Intent().setClassName(
                "com.samsung.android.lool",
                "com.samsung.android.sm.ui.battery.BatteryActivity",
            ),
            Intent("com.letv.android.letvsafe.AutobootManageActivity"),
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:${context.packageName}"),
            ),
        )
        for (intent in candidates) {
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                result.resolve(mapOf("opened" to true))
                return
            } catch (_: Exception) {
                // This vendor page does not exist; try the next known entry.
            }
        }
        result.resolve(mapOf("opened" to false))
    }

    private fun openNotificationSettings(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val context = host.context
        val channelId = payload.string("channelId")
        try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && channelId != null) {
                Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    .putExtra(Settings.EXTRA_CHANNEL_ID, channelId)
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:${context.packageName}"))
            }
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            result.resolve(mapOf("opened" to true))
        } catch (error: Exception) {
            result.reject("Unable to open notification settings", error)
        }
    }

    private fun ensureChannel(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val spec = parseChannelSpec(payload)
        if (spec == null) {
            result.reject("Channel id and name are required")
            return
        }
        result.resolve(
            mapOf(
                "id" to spec.id,
                "created" to NotificationChannels.ensure(host.context, spec),
            )
        )
    }

    private fun ensureChannels(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val rawList = payload["channels"] as? List<*>
        if (rawList == null) {
            result.reject("channels array is required")
            return
        }
        val results = ArrayList<Map<String, Any?>>(rawList.size)
        for (raw in rawList) {
            val map = raw as? Map<*, *> ?: continue
            val spec = parseChannelSpec(map) ?: continue
            val created = NotificationChannels.ensure(host.context, spec)
            results.add(mapOf("id" to spec.id, "created" to created))
        }
        result.resolve(mapOf("channels" to results))
    }

    private fun getChannelStatus(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val channelId = payload.string("id") ?: payload.string("channelId")
        if (channelId != null) {
            result.resolve(NotificationChannels.inspect(host.context, channelId).toMap())
            return
        }
        val channels = NotificationChannels.inspectAll(host.context).map { it.toMap() }
        result.resolve(mapOf("channels" to channels))
    }

    private fun postNotification(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val context = host.context
        if (!notificationsGranted(context)) {
            result.reject("Notification permission not granted")
            return
        }
        val channelId = payload.string("channelId")
        val title = payload.string("title")
        if (channelId == null || title == null) {
            result.reject("channelId and title are required")
            return
        }
        val body = payload.string("body") ?: ""
        val bigText = payload.string("bigText")
        val tag = payload.string("tag")
        val notificationId = (payload["id"] as? Number)?.toInt() ?: nextNotificationId.getAndIncrement()
        val silent = payload.boolean("silent", false)
        val autoCancel = payload.boolean("autoCancel", true)
        val onlyAlertOnce = payload.boolean("onlyAlertOnce", false)
        val ongoing = payload.boolean("ongoing", false)
        val deepLinkUri = payload.string("deepLink")?.let { runCatching { Uri.parse(it) }.getOrNull() }
        val visibility = parseLockscreenVisibility(payload["visibility"] ?: payload["lockscreenVisibility"])
            ?: NotificationCompat.VISIBILITY_PUBLIC

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(
                NativeHostApp.activityPendingIntent(
                    context,
                    requestCode = notificationId,
                    deepLink = deepLinkUri,
                )
            )
            .setAutoCancel(autoCancel)
            .setOnlyAlertOnce(onlyAlertOnce)
            .setOngoing(ongoing)
            .setVisibility(visibility)
            .setPriority(priorityOf(payload["priority"]))
            .setCategory(categoryOf(payload.string("category")))
            .setDefaults(
                if (silent) 0
                else NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE
            )

        if (bigText != null) {
            builder.setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
        }

        try {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (tag != null) {
                manager.notify(tag, notificationId, builder.build())
            } else {
                manager.notify(notificationId, builder.build())
            }
            result.resolve(
                mapOf(
                    "id" to notificationId,
                    "tag" to tag,
                    "posted" to true,
                )
            )
        } catch (error: Exception) {
            result.reject("Unable to post notification", error)
        }
    }

    private fun cancelNotification(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val context = host.context
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val id = (payload["id"] as? Number)?.toInt()
        val tag = payload.string("tag")
        val channelId = payload.string("channelId")
        var cancelled = 0

        if (id != null) {
            if (tag != null) manager.cancel(tag, id) else manager.cancel(id)
            cancelled = 1
        } else if (channelId != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            for (active in manager.activeNotifications) {
                if (active.notification.channelId == channelId) {
                    if (active.tag != null) manager.cancel(active.tag, active.id)
                    else manager.cancel(active.id)
                    cancelled += 1
                }
            }
        } else {
            result.reject("Either id or channelId is required to cancel notifications")
            return
        }
        result.resolve(mapOf("cancelled" to cancelled))
    }

    private fun openAppDetailsSettings(context: Context) {
        try {
            context.startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:${context.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (_: Exception) {
            // Nothing else can be opened without an activity manager.
        }
    }
}

internal fun parseChannelSpec(raw: Map<*, *>): NotificationChannelSpec? {
    val id = (raw["id"] as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val name = (raw["name"] as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val importance = importanceOf(raw["importance"])
    val explicitVisibility = parseLockscreenVisibility(raw["lockscreenVisibility"])
    val visibility = explicitVisibility ?: if (importance >= NotificationManager.IMPORTANCE_HIGH) {
        Notification.VISIBILITY_PUBLIC
    } else {
        null
    }
    return NotificationChannelSpec(
        id = id,
        name = name,
        description = (raw["description"] as? String) ?: "",
        importance = importance,
        sound = raw["sound"] as? Boolean ?: true,
        vibration = raw["vibration"] as? Boolean ?: true,
        showBadge = raw["showBadge"] as? Boolean ?: true,
        lockscreenVisibility = visibility,
    )
}

private fun importanceOf(value: Any?): Int = when (value) {
    is Number -> value.toInt()
    is String -> when (value.lowercase()) {
        "min", "none" -> NotificationManager.IMPORTANCE_MIN
        "low" -> NotificationManager.IMPORTANCE_LOW
        "high" -> NotificationManager.IMPORTANCE_HIGH
        "max" -> NotificationManager.IMPORTANCE_MAX
        else -> NotificationManager.IMPORTANCE_DEFAULT
    }
    else -> NotificationManager.IMPORTANCE_DEFAULT
}

private fun priorityOf(value: Any?): Int = when (value) {
    is Number -> value.toInt()
    is String -> when (value.lowercase()) {
        "min" -> NotificationCompat.PRIORITY_MIN
        "low" -> NotificationCompat.PRIORITY_LOW
        "high" -> NotificationCompat.PRIORITY_HIGH
        "max" -> NotificationCompat.PRIORITY_MAX
        else -> NotificationCompat.PRIORITY_DEFAULT
    }
    else -> NotificationCompat.PRIORITY_HIGH
}

private fun categoryOf(value: String?): String = when (value?.lowercase()) {
    "reminder" -> NotificationCompat.CATEGORY_REMINDER
    "event" -> NotificationCompat.CATEGORY_EVENT
    "alarm" -> NotificationCompat.CATEGORY_ALARM
    "error" -> NotificationCompat.CATEGORY_ERROR
    "message" -> NotificationCompat.CATEGORY_MESSAGE
    "progress" -> NotificationCompat.CATEGORY_PROGRESS
    else -> NotificationCompat.CATEGORY_STATUS
}

internal fun notificationsGranted(context: Context): Boolean {
    val runtimeGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED
    return runtimeGranted && NotificationManagerCompat.from(context).areNotificationsEnabled()
}

internal fun canScheduleExactAlarms(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return false
    return runCatching { alarmManager.canScheduleExactAlarms() }.getOrDefault(false)
}

internal fun isIgnoringBatteryOptimizations(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    val powerManager = context.getSystemService(PowerManager::class.java) ?: return false
    return powerManager.isIgnoringBatteryOptimizations(context.packageName)
}

private fun Map<String, Any?>.string(key: String): String? =
    (this[key] as? String)?.takeIf { it.isNotBlank() }

private fun Map<String, Any?>.boolean(key: String, default: Boolean): Boolean =
    this[key] as? Boolean ?: default
