package me.uwen.orahako.notify

import android.os.Build
import android.util.Log
import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeCapabilityReconciler
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.nativebridge.kotlinValueToJson
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Class reminder capability: exact alarms, the foreground Live Update service
 * and the persisted reminder list.
 *
 * The capability receives an opaque alarm list from JavaScript and only owns
 * delivery: validation, AlarmManager scheduling, foreground-service shutdown
 * and reboot reconciliation. Calendar arithmetic stays in JavaScript.
 */
class ClassRemindersCapability(
    private val host: NativeCapabilityHost,
    override val config: Map<String, Any?>,
) : NativeCapability, NativeCapabilityReconciler {

    companion object {
        const val ID = "reminders.classes"
        const val VERSION = 1

        private const val METHOD_SCHEDULE = "schedule"
        private const val METHOD_CANCEL = "cancel"
        private const val METHOD_DEBUG = "debug"
    }

    override val id: String = ID
    override val version: Int = VERSION

    override val methods: Set<String> = setOf(METHOD_SCHEDULE, METHOD_CANCEL, METHOD_DEBUG)

    override fun bind(): NativeCapabilityBinding = Binding()

    override fun reconcile() {
        val context = host.context
        ClassReminderNotifications.ensureChannels(context)
        val alarms = ClassReminderState.alarmsJson(context)
        if (alarms.isBlank() || alarms == "[]") return
        try {
            ClassAlarmManager.scheduleAlarms(context, alarms)
        } catch (error: Exception) {
            Log.e("OrahakoClassReminder", "Unable to restore class reminders", error)
        }
    }

    private inner class Binding : NativeCapabilityBinding {
        override fun invoke(
            method: String,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            when (method) {
                METHOD_SCHEDULE -> schedule(payload, result)
                METHOD_CANCEL -> cancel(result)
                METHOD_DEBUG -> debug(payload, result)
            }
        }

        /** Releases runtime delivery only; persisted alarms remain for reconciliation. */
        override fun release() {
            ClassReminderService.stop(host.context)
        }
    }

    private fun schedule(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val alarms = alarmsOf(payload)
        if (alarms == null) {
            result.reject("Missing alarms")
            return
        }
        try {
            ClassAlarmManager.scheduleAlarms(host.context, alarms.toString())
            result.resolve(mapOf("scheduled" to alarms.length()))
        } catch (error: Exception) {
            result.reject("Unable to schedule class reminders", error)
        }
    }

    private fun cancel(result: NativeInvokeResult) {
        try {
            ClassAlarmManager.cancelAllAlarms(host.context)
            ClassReminderNotifications.cancelAll(host.context)
            result.resolve(mapOf("cancelled" to true))
        } catch (error: Exception) {
            result.reject("Unable to cancel class reminders", error)
        }
    }

    /**
     * Debug builds only: schedules one reminder through the real cache,
     * alarm, service and optional vibration path.
     */
    private fun debug(payload: Map<String, Any?>, result: NativeInvokeResult) {
        if (!BuildConfig.DEBUG) {
            result.reject("debug builds only")
            return
        }
        val context = host.context
        val courseName = payload.string("courseName") ?: "测试课程"
        val classroom = payload.string("classroom") ?: "调试教室"
        val startInMinutes = (payload["startInMinutes"] as? Number)?.toInt()?.coerceAtLeast(0) ?: 2
        val liveUpdateEnabled = payload["liveUpdateEnabled"] as? Boolean ?: true
        val vibrationEnabled = payload["vibrationEnabled"] as? Boolean ?: false
        val startAt = System.currentTimeMillis() + startInMinutes * 60_000L
        val startTime = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(startAt))
        if (liveUpdateEnabled && Build.VERSION.SDK_INT < Build.VERSION_CODES.BAKLAVA) {
            result.resolve(mapOf("posted" to false))
            return
        }
        try {
            synchronized(ClassAlarmManager) {
                val alarms = JSONArray(ClassReminderState.alarmsJson(context))
                alarms.put(
                    JSONObject()
                        .put("alarmId", "debug-$startAt")
                        .put("alarmTime", startAt - 15 * 60_000L)
                        .put("startAt", startAt)
                        .put("remindMinutes", 15)
                        .put("courseName", courseName)
                        .put("classroom", classroom)
                        .put("startTime", startTime)
                        .put("endAt", startAt + 45 * 60_000L)
                        .put("liveUpdateEnabled", liveUpdateEnabled)
                        .put("vibrationEnabled", vibrationEnabled)
                )
                ClassAlarmManager.scheduleAlarms(context, alarms.toString())
            }
            result.resolve(mapOf("posted" to true))
        } catch (error: Exception) {
            result.reject("Unable to schedule debug class reminder", error)
        }
    }

    private fun alarmsOf(payload: Map<String, Any?>): JSONArray? = when (val raw = payload["alarms"]) {
        is JSONArray -> raw
        is List<*> -> JSONArray().apply { raw.forEach { put(kotlinValueToJson(it)) } }
        is String -> runCatching { JSONArray(raw) }.getOrNull()
        else -> (payload["alarmsJson"] as? String)?.let {
            runCatching { JSONArray(it) }.getOrNull()
        }
    }
}

private fun Map<String, Any?>.string(key: String): String? =
    (this[key] as? String)?.takeIf { it.isNotBlank() }
