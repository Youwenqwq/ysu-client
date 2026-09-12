package com.youwenqwq.ysuclient.notify

import android.Manifest
import android.content.Context
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

    // ─── Permission management ──────────────────────────────────────────────

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
