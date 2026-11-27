package me.uwen.orahako.notify

import android.os.Build
import android.util.Log
import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeCapabilityInitializer
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
) : NativeCapability, NativeCapabilityInitializer, NativeCapabilityReconciler {

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

    override fun initialize() {
        ClassReminderNotifications.ensureChannels(host.context)
    }

    override fun bind(): NativeCapabilityBinding {
        ClassReminderNotifications.ensureChannels(host.context)
        return Binding()
    }

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
                METHOD_CANCEL -> cancel(payload, result)
                METHOD_DEBUG -> debug(payload, result)
            }
        }

        /** Temporary invoke leases must not stop an active Live Update foreground service. */
        override fun release() = Unit
    }

    private fun schedule(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val alarms = alarmsOf(payload)
        if (alarms == null) {
            result.reject("Missing alarms")
            return
        }
        val namespace = payload.string("namespace")
        try {
            ClassReminderNotifications.ensureChannels(host.context)
            val merged = mergeAlarmsByNamespace(host.context, alarms, namespace)
            ClassAlarmManager.scheduleAlarms(host.context, merged.toString())
            val response = LinkedHashMap<String, Any?>()
            response["scheduled"] = alarms.length()
            if (namespace != null) response["namespace"] = namespace
            result.resolve(response)
        } catch (error: Exception) {
            result.reject("Unable to schedule class reminders", error)
        }
    }

    private fun cancel(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val namespace = payload.string("namespace")
        try {
            if (namespace != null) {
                val remaining = filterOutNamespace(host.context, namespace)
                if (remaining.length() == 0) {
                    ClassAlarmManager.cancelAllAlarms(host.context)
                    ClassReminderNotifications.cancelAll(host.context)
                } else {
                    ClassAlarmManager.scheduleAlarms(host.context, remaining.toString())
                }
                result.resolve(mapOf("cancelled" to true, "namespace" to namespace))
            } else {
                ClassAlarmManager.cancelAllAlarms(host.context)
                ClassReminderNotifications.cancelAll(host.context)
                result.resolve(mapOf("cancelled" to true))
            }
        } catch (error: Exception) {
            result.reject("Unable to cancel class reminders", error)
        }
    }

    private fun mergeAlarmsByNamespace(
        context: android.content.Context,
        incoming: JSONArray,
        namespace: String?,
    ): JSONArray {
        if (namespace == null) return incoming
        val merged = filterOutNamespace(context, namespace)
        for (i in 0 until incoming.length()) {
            val item = JSONObject(incoming.getJSONObject(i).toString())
            item.put("namespace", namespace)
            merged.put(item)
        }
        return merged
    }

    private fun filterOutNamespace(context: android.content.Context, namespace: String): JSONArray {
        val existing = runCatching { JSONArray(ClassReminderState.alarmsJson(context)) }
            .getOrElse { JSONArray() }
        val kept = JSONArray()
        for (i in 0 until existing.length()) {
            val item = existing.optJSONObject(i) ?: continue
            if (item.optString("namespace", "") != namespace) {
                kept.put(item)
            }
        }
        return kept
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
