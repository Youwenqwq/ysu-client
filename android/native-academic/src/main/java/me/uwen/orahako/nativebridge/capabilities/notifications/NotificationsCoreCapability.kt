package me.uwen.orahako.nativebridge.capabilities.notifications

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeCapabilityReconciler
import me.uwen.orahako.nativebridge.NativeInvokeResult

/**
 * Notification permissions, channel operations and the system settings the
 * app asks the user to open (exact alarms, battery optimization, auto-start).
 *
 * The capability never publishes notifications: channel catalogs and copy stay
 * with the publisher that owns the channel. `config` may declare additional
 * channels, which are ensured when the capability is bound.
 */
class NotificationsCoreCapability(
    private val host: NativeCapabilityHost,
    override val config: Map<String, Any?>,
) : NativeCapability, NativeCapabilityReconciler {

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
        private const val METHOD_CANCEL_ALL = "cancelAll"
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
        METHOD_CANCEL_ALL,
    )

    override fun bind(): NativeCapabilityBinding {
        ensureConfiguredChannels()
        return Binding()
    }

    override fun reconcile() {
        ensureConfiguredChannels()
    }

    /**
     * Channels declared by the composition config (publishers still own their
     * own catalogs). Re-applied on acquire and after reboot/update.
     */
    private fun ensureConfiguredChannels() {
        val channels = config["channels"] as? List<*> ?: return
        for (raw in channels) {
            val channel = raw as? Map<*, *> ?: continue
            val id = channel["id"] as? String ?: continue
            val name = channel["name"] as? String ?: continue
            NotificationChannels.ensure(
                host.context,
                NotificationChannelSpec(
                    id = id,
                    name = name,
                    description = channel["description"] as? String ?: "",
                    importance = importanceOf(channel["importance"]),
                    sound = channel["sound"] as? Boolean ?: true,
                    vibration = channel["vibration"] as? Boolean ?: true,
                    showBadge = channel["showBadge"] as? Boolean ?: true,
                ),
            )
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
                METHOD_OPEN_SETTINGS -> openNotificationSettings(result)
                METHOD_ENSURE_CHANNEL -> ensureChannel(payload, result)
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
            result.resolve(mapOf("granted" to notificationsGranted(context)))
            return
        }
        try {
            host.requestPermissions(NOTIFICATION_PERMISSIONS) {
                result.resolve(mapOf("granted" to notificationsGranted(context)))
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

    private fun openNotificationSettings(result: NativeInvokeResult) {
        val context = host.context
        try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
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
        val id = payload.string("id")
        val name = payload.string("name")
        if (id == null || name == null) {
            result.reject("Channel id and name are required")
            return
        }
        val spec = NotificationChannelSpec(
            id = id,
            name = name,
            description = payload.string("description") ?: "",
            importance = importanceOf(payload["importance"]),
            sound = payload.boolean("sound", true),
            vibration = payload.boolean("vibration", true),
            showBadge = payload.boolean("showBadge", true),
        )
        result.resolve(
            mapOf(
                "id" to spec.id,
                "created" to NotificationChannels.ensure(host.context, spec),
            )
        )
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
