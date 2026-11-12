package com.youwenqwq.ysuclient.notify

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Observer
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.Operation
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.youwenqwq.ysuclient.BuildConfig
import com.youwenqwq.ysuclient.cache.UnifiedCache
import java.util.concurrent.TimeUnit

/**
 * Capacitor 插件：成绩/考试通知后台轮询。
 *
 * JS 端通过此插件控制后台轮询的启停、传递 CASTGC、管理通知权限。
 */
@CapacitorPlugin(
    name = "YsuNotify",
    permissions = [
        Permission(
            strings = [Manifest.permission.POST_NOTIFICATIONS],
            alias = "notifications"
        )
    ]
)
class YsuNotifyPlugin : Plugin() {

    companion object {
        const val TAG = "YsuNotifyPlugin"
    }

    // ─── CASTGC management ──────────────────────────────────────────────────

    @PluginMethod
    fun setCastgc(call: PluginCall) {
        val castgc = call.getString("castgc")
        Log.d(TAG, "setCastgc called, castgc=${if (castgc.isNullOrEmpty()) "NULL/EMPTY" else "PRESENT(len=${castgc.length})"}")
        if (castgc.isNullOrEmpty()) {
            call.reject("castgc is required")
            return
        }
        UnifiedCache.putString(context, UnifiedCache.KEY_CASTGC, castgc)
        NotifyHelper.setSessionExpired(context, false)
        Log.d(TAG, "CASTGC saved to UnifiedCache")
        call.resolve()
    }

    @PluginMethod
    fun clearCastgc(call: PluginCall) {
        UnifiedCache.remove(context, UnifiedCache.KEY_CASTGC)
        NotifyHelper.setSessionExpired(context, false)
        Log.d(TAG, "CASTGC cleared")
        call.resolve()
    }

    // ─── Server config ──────────────────────────────────────────────────────

    @PluginMethod
    fun setServerConfig(call: PluginCall) {
        val config = call.getString("configJson")
        if (config.isNullOrEmpty()) {
            call.reject("config is required")
            return
        }
        UnifiedCache.putString(context, UnifiedCache.KEY_SERVER_CONFIG, config)
        Log.d(TAG, "Server config saved to UnifiedCache")
        call.resolve()
    }


    // ─── Cached data bridge ─────────────────────────────────────────────────

    @PluginMethod
    fun getCachedGrades(call: PluginCall) {
        val gradesJson = UnifiedCache.getString(context, UnifiedCache.KEY_NOTIFY_CACHED_GRADES, "[]")
        val ret = JSObject()
        ret.put("gradesJson", gradesJson)
        call.resolve(ret)
    }

    @PluginMethod
    fun setCachedGrades(call: PluginCall) {
        val gradesJson = call.getString("gradesJson")
        if (gradesJson.isNullOrEmpty()) {
            call.reject("gradesJson is required")
            return
        }
        UnifiedCache.putString(context, UnifiedCache.KEY_NOTIFY_CACHED_GRADES, gradesJson)
        NotifyHelper.setGradesBaselineInitialized(context, true)
        call.resolve()
    }

    @PluginMethod
    fun getCachedExams(call: PluginCall) {
        val examsJson = UnifiedCache.getString(context, UnifiedCache.KEY_NOTIFY_CACHED_EXAMS, "[]")
        val ret = JSObject()
        ret.put("examsJson", examsJson)
        call.resolve(ret)
    }

    @PluginMethod
    fun setCachedExams(call: PluginCall) {
        val examsJson = call.getString("examsJson")
        if (examsJson.isNullOrEmpty()) {
            call.reject("examsJson is required")
            return
        }
        UnifiedCache.putString(context, UnifiedCache.KEY_NOTIFY_CACHED_EXAMS, examsJson)
        NotifyHelper.setExamsBaselineInitialized(context, true)
        call.resolve()
    }

    @PluginMethod
    fun setProviderIdentity(call: PluginCall) {
        val providerId = call.getString("providerId")
        val accountHash = call.getString("accountHash")
        if (providerId.isNullOrEmpty() || accountHash.isNullOrEmpty()) {
            call.reject("providerId and accountHash are required")
            return
        }
        NotifyHelper.saveProviderIdentity(context, providerId, accountHash)
        call.resolve()
    }

    // ─── Polling control ────────────────────────────────────────────────────

    @PluginMethod
    fun startPolling(call: PluginCall) {
        val interval = call.getInt("intervalMinutes", 60) ?: 60
        val checkGrades = call.getBoolean("checkGrades", true) ?: true
        val checkExams = call.getBoolean("checkExams", true) ?: true
        val notifyNetworkError = call.getBoolean("notifyNetworkError", false) ?: false

        // WorkManager 最小间隔为 15 分钟
        val workInterval = interval.coerceAtLeast(15)

        NotifyHelper.saveSettings(context, workInterval, checkGrades, checkExams, notifyNetworkError)
        UnifiedCache.putBoolean(context, UnifiedCache.KEY_NOTIFY_POLLING_ENABLED, true)

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val workRequest = PeriodicWorkRequestBuilder<NotifyWorker>(
            workInterval.toLong(), TimeUnit.MINUTES
        )
            .setInitialDelay(workInterval.toLong(), TimeUnit.MINUTES)
            .setConstraints(constraints)
            .addTag(NotifyWorker.WORK_NAME)
            .build()

        val operation = WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            NotifyWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            workRequest
        )

        Log.d(TAG, "Polling started: interval=$workInterval min, grades=$checkGrades, exams=$checkExams")
        resolveWork(call, operation)
    }

    @PluginMethod
    fun stopPolling(call: PluginCall) {
        val wm = WorkManager.getInstance(context)
        UnifiedCache.putBoolean(context, UnifiedCache.KEY_NOTIFY_POLLING_ENABLED, false)
        wm.cancelUniqueWork(NotifyWorker.WORK_NAME)
        val operation = wm.cancelAllWorkByTag(NotifyWorker.WORK_NAME)
        Log.d(TAG, "Polling stopped")
        resolveWork(call, operation)
    }

    @PluginMethod
    fun pausePolling(call: PluginCall) {
        UnifiedCache.putBoolean(context, UnifiedCache.KEY_NOTIFY_POLLING_ENABLED, false)
        val operation = WorkManager.getInstance(context).cancelAllWorkByTag(NotifyWorker.WORK_NAME)
        Log.d(TAG, "Polling paused")
        resolveWork(call, operation)
    }

    @PluginMethod
    fun resumePolling(call: PluginCall) {
        val (interval, checkGrades, checkExams, notifyNetworkError) = NotifyHelper.getSettingsWithNetworkError(context)
        val workInterval = interval.coerceAtLeast(15)

        NotifyHelper.saveSettings(context, workInterval, checkGrades, checkExams, notifyNetworkError)
        UnifiedCache.putBoolean(context, UnifiedCache.KEY_NOTIFY_POLLING_ENABLED, true)

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val workRequest = PeriodicWorkRequestBuilder<NotifyWorker>(
            workInterval.toLong(), TimeUnit.MINUTES
        )
            .setInitialDelay(workInterval.toLong(), TimeUnit.MINUTES)
            .setConstraints(constraints)
            .addTag(NotifyWorker.WORK_NAME)
            .build()

        val operation = WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            NotifyWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            workRequest
        )

        Log.d(TAG, "Polling resumed: interval=$workInterval min, grades=$checkGrades, exams=$checkExams")
        resolveWork(call, operation)
    }

    @PluginMethod
    fun executeOnce(call: PluginCall) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val workRequest = OneTimeWorkRequestBuilder<NotifyWorker>()
            .setConstraints(constraints)
            .addTag(NotifyWorker.WORK_NAME)
            .build()

        val operation = WorkManager.getInstance(context).enqueueUniqueWork(
            NotifyWorker.IMMEDIATE_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            workRequest
        )

        Log.d(TAG, "One-time worker enqueued")
        resolveWork(call, operation)
    }

    private fun resolveWork(call: PluginCall, operation: Operation) {
        ContextCompat.getMainExecutor(context).execute {
            operation.state.observeForever(object : Observer<Operation.State> {
                override fun onChanged(state: Operation.State) {
                    when (state) {
                        is Operation.State.SUCCESS -> {
                            operation.state.removeObserver(this)
                            call.resolve()
                        }
                        is Operation.State.FAILURE -> {
                            operation.state.removeObserver(this)
                            call.reject("Unable to update notification work", Exception(state.throwable))
                        }
                    }
                }
            })
        }
    }

    // ─── Class alarms (delegates to ClassAlarmManager) ──────────────────────

    @PluginMethod
    fun scheduleClassAlarms(call: PluginCall) {
        val alarmsJson = call.getString("alarmsJson") ?: "[]"
        try {
            ClassAlarmManager.scheduleAlarms(context, alarmsJson)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Unable to schedule class reminders", e)
        }
    }

    @PluginMethod
    fun cancelClassAlarms(call: PluginCall) {
        try {
            ClassAlarmManager.cancelAllAlarms(context)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Unable to cancel class reminders", e)
        }
    }

    // ─── Debug helpers ──────────────────────────────────────────────────────

    /**
     * 仅调试构建可用：startInMinutes 是实际上课倒计时，不再叠加预热。
     * 15 分钟普通提醒与可选强震动先触发，到点才启动可选 Live Update。
     */
    @PluginMethod
    fun debugLiveUpdate(call: PluginCall) {
        if (!BuildConfig.DEBUG) {
            call.reject("debug builds only")
            return
        }
        val courseName = call.getString("courseName")?.takeIf { it.isNotBlank() } ?: "测试课程"
        val classroom = call.getString("classroom")?.takeIf { it.isNotBlank() } ?: "调试教室"
        val startInMinutes = (call.getInt("startInMinutes") ?: 2).coerceAtLeast(0)
        val startAt = System.currentTimeMillis() + startInMinutes * 60_000L
        val startTime = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
            .format(java.util.Date(startAt))
        val liveUpdateEnabled = call.getBoolean("liveUpdateEnabled") ?: true
        val vibrationEnabled = call.getBoolean("vibrationEnabled") ?: false
        if (liveUpdateEnabled && Build.VERSION.SDK_INT < Build.VERSION_CODES.BAKLAVA) {
            call.resolve(JSObject().put("posted", false))
            return
        }
        try {
            synchronized(ClassAlarmManager) {
                val alarms = org.json.JSONArray(
                    UnifiedCache.getString(context, UnifiedCache.KEY_CLASS_ALARMS, "[]")
                )
                alarms.put(org.json.JSONObject()
                    .put("alarmId", "debug-$startAt")
                    .put("alarmTime", startAt - 15 * 60_000L)
                    .put("startAt", startAt)
                    .put("remindMinutes", 15)
                    .put("courseName", courseName)
                    .put("classroom", classroom)
                    .put("startTime", startTime)
                    .put("endAt", startAt + 45 * 60_000L)
                    .put("liveUpdateEnabled", liveUpdateEnabled)
                    .put("vibrationEnabled", vibrationEnabled))
                ClassAlarmManager.scheduleAlarms(context, alarms.toString())
            }
            call.resolve(JSObject().put("posted", true))
        } catch (e: Exception) {
            call.reject("Unable to schedule debug class reminder", e)
        }
    }

    // ─── Permission management ──────────────────────────────────────────────

    @PluginMethod
    fun checkExactAlarmPermission(call: PluginCall) {
        call.resolve(
            JSObject().put("granted", ClassAlarmScheduling.canScheduleExact(context))
        )
    }

    @PluginMethod
    fun requestExactAlarmPermission(call: PluginCall) {
        if (ClassAlarmScheduling.canScheduleExact(context)) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        try {
            val intent = Intent(
                android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                android.net.Uri.parse("package:${context.packageName}")
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve(JSObject().put("granted", false))
        } catch (e: Exception) {
            call.reject("Unable to open exact alarm settings", e)
        }
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(JSObject().put("granted", notificationsGranted()))
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED
            ) {
                call.resolve(JSObject().put("granted", notificationsGranted()))
                return
            }

            requestPermissionForAlias("notifications", call, "notificationsPermissionCallback")
        } else {
            call.resolve(JSObject().put("granted", notificationsGranted()))
        }
    }

    @PermissionCallback
    fun notificationsPermissionCallback(call: PluginCall) {
        call.resolve(JSObject().put("granted", notificationsGranted()))
    }

    private fun notificationsGranted(): Boolean {
        val runtimeGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        return runtimeGranted && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    // ─── Vendor background settings ─────────────────────────────────────────

    /**
     * 跳转到厂商的「自启动 / 后台运行」管理页。
     * 各厂商页面不同，按已知入口依次尝试，最后回落到应用详情页。
     */
    @PluginMethod
    fun openAutoStartSettings(call: PluginCall) {
        val candidates = listOf(
            Intent().setClassName(
                "com.oplus.battery",
                "com.oplus.startupapp.view.StartupAppListActivity"
            ),
            Intent("com.coloros.safecenter.permission.startup.StartupAppListActivity"),
            Intent("com.oppo.safe.permission.startup.StartupAppListActivity"),
            Intent("com.miui.permcenter.autostart.AutoStartManagementActivity"),
            Intent("com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
            Intent("com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
            Intent().setClassName(
                "com.samsung.android.lool",
                "com.samsung.android.sm.ui.battery.BatteryActivity"
            ),
            Intent("com.letv.android.letvsafe.AutobootManageActivity"),
            Intent(
                android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                android.net.Uri.parse("package:${context.packageName}")
            )
        )
        for (intent in candidates) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                call.resolve(JSObject().put("opened", true))
                return
            } catch (_: Exception) {
                // 该入口不存在，试下一个
            }
        }
        call.reject("unable to open auto-start settings")
    }

    // ─── Battery optimization & auto-start ─────────────────────────────────

    @PluginMethod
    fun checkBatteryOptimization(call: PluginCall) {
        val ret = JSObject()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            ret.put("ignored", pm.isIgnoringBatteryOptimizations(context.packageName))
        } else {
            ret.put("ignored", true)
        }
        call.resolve(ret)
    }

    @PluginMethod
    fun requestIgnoreBatteryOptimization(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            if (!pm.isIgnoringBatteryOptimizations(context.packageName)) {
                try {
                    val intent = android.content.Intent(
                        android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        android.net.Uri.parse("package:${context.packageName}")
                    )
                    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(intent)
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to open battery optimization settings", e)
                    // Fallback to app details settings
                    try {
                        val intent = android.content.Intent(
                            android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            android.net.Uri.parse("package:${context.packageName}")
                        )
                        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                        context.startActivity(intent)
                    } catch (e2: Exception) {
                        Log.e(TAG, "Failed to open app details settings", e2)
                    }
                }
            }
        }
        call.resolve()
    }

}
