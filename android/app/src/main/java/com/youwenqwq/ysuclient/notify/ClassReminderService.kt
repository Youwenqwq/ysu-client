package com.youwenqwq.ysuclient.notify

import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import androidx.core.app.NotificationCompat
import com.youwenqwq.ysuclient.R
import com.youwenqwq.ysuclient.cache.UnifiedCache
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** Refreshes Live Updates from reminder time; absolute-time delays own boundaries and silent handoffs. */
class ClassReminderService : Service() {
    companion object {
        private const val TAG = "YsuClassReminder"
        private const val DELIVERY_PREFS = "ysu_class_start_delivery"
        private const val TICK_MS = 30_000L
        @Volatile private var running: ClassReminderService? = null

        internal fun startAt(alarm: JSONObject): Long =
            alarm.optLong("startAt").takeIf { it > 0L }
                ?: (alarm.optLong("alarmTime") + alarm.optInt("remindMinutes", 15) * 60_000L)

        internal fun expiryAt(alarm: JSONObject): Long {
            val start = startAt(alarm)
            return alarm.optLong("endAt").takeIf { it > start } ?: (start + 60_000L)
        }

        private fun text(alarm: JSONObject, key: String, fallback: String = ""): String {
            val value = alarm.opt(key)
            if (value == null || value === JSONObject.NULL) return fallback
            return value.toString().trim().takeUnless { it.isEmpty() || it == "null" } ?: fallback
        }

        internal fun nextClass(context: Context, currentId: String, endedAt: Long): JSONObject? =
            ClassLiveUpdate.findNextClass(context, currentId, endedAt)

        internal fun isMonitoring(alarmId: String): Boolean = running?.jobs?.containsKey(alarmId) == true

        internal fun needsForegroundNotification(): Boolean = running?.foregroundReady == false

        internal fun attachLiveNotification(alarmId: String, notification: Notification): Boolean {
            val service = running ?: return false
            service.promoteLiveNotification(ClassLiveUpdate.notificationId(alarmId), notification)
            return true
        }

        internal fun detachLiveNotification(alarmId: String) {
            val service = running ?: return
            if (service.foregroundId == ClassLiveUpdate.notificationId(alarmId)) {
                service.stopForeground(STOP_FOREGROUND_DETACH)
                service.foregroundReady = false
                service.foregroundId = null
            }
        }

        internal fun start(context: Context, alarm: JSONObject): Boolean {
            if (!ClassAlarmManager.supportsLiveUpdate(context, alarm)) return false
            // Only a live handoff may resume before its configured reminder time.
            // At the first reminder, notify() may not have reached the system yet.
            if (System.currentTimeMillis() < minOf(startAt(alarm), alarm.optLong("alarmTime"))) {
                val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (manager.activeNotifications.none {
                        it.id == ClassLiveUpdate.notificationId(alarm.optString("alarmId")) && it.isOngoing
                    }) return false
            }
            val intent = Intent(context, ClassReminderService::class.java)
                .putExtra(ClassAlarmReceiver.EXTRA_ALARM_ID, alarm.getString("alarmId"))
                .putExtra(ClassAlarmReceiver.EXTRA_ALARM_TIME, alarm.getLong("alarmTime"))
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
                true
            } catch (e: RuntimeException) {
                // Includes Android 12+ ForegroundServiceStartNotAllowedException and
                // revoked permissions. Do not advertise an unavailable exact timer.
                reportFailure(context, e)
                false
            }
        }

        fun stop(context: Context) {
            running?.shutdown()
            context.stopService(Intent(context, ClassReminderService::class.java))
        }

        internal fun reportFailure(context: Context, error: Throwable) {
            Log.e(TAG, "Foreground class timer unavailable; on-time reminders are not guaranteed", error)
            try {
                val notification = NativeNotifications.builder(context, NotificationKind.ERRORS)
                    .setContentTitle(context.getString(R.string.class_timer_error_title))
                    .setContentText(context.getString(R.string.class_timer_error_text))
                    .setStyle(NotificationCompat.BigTextStyle().bigText(context.getString(R.string.class_timer_error_text)))
                    .build()
                (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                    .notify("class-timer-error", 0, notification)
            } catch (notificationError: RuntimeException) {
                Log.e(TAG, "Unable to display timer failure (notification permission may be denied)", notificationError)
            }
        }

        internal fun claimDelivery(
            context: Context, id: String, start: Long, end: Long
        ): Boolean {
            val prefs = context.getSharedPreferences(DELIVERY_PREFS, Context.MODE_PRIVATE)
            val legacyKey = "$id:$start"
            val key = "vibration:$legacyKey"
            // Old unified claims may already have vibrated; only the waveform is
            // deduplicated. Ordinary reminders retain their upstream delivery rules.
            if (prefs.contains(legacyKey) || prefs.contains(key)) return false
            val editor = prefs.edit()
            val now = System.currentTimeMillis()
            for ((savedKey, expiry) in prefs.all) {
                if (expiry is Long && expiry < now) editor.remove(savedKey)
            }
            check(editor.putLong(key, end).commit()) { "Unable to persist class start delivery" }
            return true
        }

        /** ALU reminders start the same foreground timer used by class and handoff updates. */
        internal fun sendReminder(context: Context, alarm: JSONObject): Boolean {
            val id = alarm.getString("alarmId")
            val start = startAt(alarm)
            val expiry = expiryAt(alarm)
            val end = alarm.optLong("endAt")
            val livePosted = ClassAlarmManager.supportsLiveUpdate(context, alarm) &&
                ClassLiveUpdate.post(
                    context, id,
                    text(alarm, "courseName", context.getString(R.string.notify_fallback_alarm_course)),
                    text(alarm, "classroom"), text(alarm, "startTime"), start,
                    alarm.optInt("remindMinutes", 15), alarm.optInt("conflictCount", 1), end
                )
            if (livePosted) {
                ClassReminderService.start(context, alarm)
            } else {
                val parts = buildList {
                    val startTime = text(alarm, "startTime")
                    val classroom = text(alarm, "classroom")
                    if (startTime.isNotEmpty()) add(startTime)
                    if (classroom.isNotEmpty()) add(classroom)
                }
                val content = if (parts.isNotEmpty()) parts.joinToString(" · ")
                    else context.getString(R.string.class_alarm_text, alarm.optInt("remindMinutes", 15))
                val notification = NativeNotifications.builder(context, NotificationKind.CLASSES)
                    .setContentTitle(text(alarm, "courseName", context.getString(R.string.notify_fallback_alarm_course)))
                    .setContentText(content)
                    .build()
                (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                    .notify("class:$id", 0, notification)
            }
            if (!alarm.optBoolean("vibrationEnabled", false)) return false
            val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            if (!vibrator.hasVibrator() ||
                !claimDelivery(context, id, start, expiry)) return false
            vibrateReminder(vibrator)
            return true
        }

        @Suppress("DEPRECATION")
        private fun vibrateReminder(vibrator: Vibrator) {
            val pattern = longArrayOf(0, 450, 140, 600, 140, 800)
            val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(
                    pattern, intArrayOf(0, 255, 0, 255, 0, 255), -1
                ), attributes)
            } else vibrator.vibrate(pattern, -1, attributes)
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val jobs = ConcurrentHashMap<String, Job>()
    private val monitoredUntil = ConcurrentHashMap<String, Long>()
    private var wakeLock: PowerManager.WakeLock? = null
    private var foregroundReady = false
    private var foregroundId: Int? = null
    private var dispatchingStart = false
    private var stopped = false

    override fun onCreate() {
        super.onCreate()
        running = this
    }

    private fun promoteLiveNotification(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else startForeground(id, notification)
        foregroundId = id
        foregroundReady = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        synchronized(ClassAlarmManager) {
            dispatchingStart = true
            try {
                val id = intent?.getStringExtra(ClassAlarmReceiver.EXTRA_ALARM_ID)
                if (id != null) {
                    val alarm = savedAlarm(id)
                    if (alarm != null && alarm.optLong("alarmTime") ==
                        intent.getLongExtra(ClassAlarmReceiver.EXTRA_ALARM_TIME, 0L)) monitor(alarm)
                } else {
                    // START_STICKY restart restores every due, still-active class, including
                    // a live upcoming handoff whose start alarm has not fired yet.
                    val now = System.currentTimeMillis()
                    val activeIds = (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                        .activeNotifications.map { it.id }.toSet()
                    val alarms = savedAlarms()
                    for (i in 0 until alarms.length()) {
                        val alarm = alarms.getJSONObject(i)
                        if (startAt(alarm) <= now ||
                            activeIds.contains(ClassLiveUpdate.notificationId(alarm.optString("alarmId")))) monitor(alarm)
                    }
                }
            } catch (e: Exception) {
                reportFailure(this, e)
            } finally {
                dispatchingStart = false
            }
            if (jobs.isEmpty()) shutdown()
        }
        return if (foregroundReady) START_STICKY else START_NOT_STICKY
    }

    private fun monitor(alarm: JSONObject) {
        val id = alarm.optString("alarmId")
        val start = startAt(alarm)
        val end = alarm.optLong("endAt")
        val expiry = expiryAt(alarm)
        val live = alarm.optBoolean("liveUpdateEnabled", false) &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA && end > start
        if (id.isBlank() || expiry <= System.currentTimeMillis() || jobs.containsKey(id)) return
        if (!foregroundReady) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.activeNotifications.firstOrNull {
                it.id == ClassLiveUpdate.notificationId(id) && it.isOngoing
            }?.let { promoteLiveNotification(it.id, it.notification) }
        }
        monitoredUntil[id] = if (live) end else minOf(expiry, start + 10_000L)
        renewWakeLock()
        // Store before launch so an immediately due timer cannot finish before registration.
        val job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                val extras = ClassLiveUpdate.buildExtras(
                    text(alarm, "courseName", getString(R.string.notify_fallback_alarm_course)),
                    text(alarm, "classroom"), start, end,
                    alarm.optInt("remindMinutes", 15), alarm.optInt("conflictCount", 1)
                )
                // Start refreshing the first upcoming class as well as live handoffs.
                if (live && System.currentTimeMillis() < start) {
                    ClassLiveUpdate.post(
                        this@ClassReminderService, id,
                        text(alarm, "courseName", getString(R.string.notify_fallback_alarm_course)),
                        text(alarm, "classroom"), text(alarm, "startTime"), start,
                        alarm.optInt("remindMinutes", 15), alarm.optInt("conflictCount", 1), end
                    )
                }
                while (System.currentTimeMillis() < start) {
                    val now = System.currentTimeMillis()
                    val nextMinute = start - ((start - now - 1L) / 60_000L) * 60_000L
                    delayUntil(minOf(nextMinute, now - now % TICK_MS + TICK_MS))
                    synchronized(ClassAlarmManager) {
                        if (!isCurrent(alarm)) return@launch
                        if (live && System.currentTimeMillis() < start) ClassLiveUpdate.onTick(this@ClassReminderService, id, extras)
                    }
                }
                synchronized(ClassAlarmManager) {
                    if (!isCurrent(alarm) || System.currentTimeMillis() >= expiry) return@launch
                    if (live) ClassLiveUpdate.post(
                        this@ClassReminderService, id,
                        text(alarm, "courseName", getString(R.string.notify_fallback_alarm_course)),
                        text(alarm, "classroom"), text(alarm, "startTime"), start,
                        alarm.optInt("remindMinutes", 15), alarm.optInt("conflictCount", 1), end
                    )
                }
                if (!live) return@launch
                while (System.currentTimeMillis() < end) {
                    val now = System.currentTimeMillis()
                    delayUntil(minOf(end, now - now % TICK_MS + TICK_MS))
                    synchronized(ClassAlarmManager) {
                        if (!isCurrent(alarm)) return@launch
                        // Only markEnded owns the end transition, never onTick at end.
                        if (System.currentTimeMillis() < end) ClassLiveUpdate.onTick(this@ClassReminderService, id, extras)
                    }
                }
                synchronized(ClassAlarmManager) {
                    if (!isCurrent(alarm)) return@launch
                    ClassLiveUpdate.markEnded(this@ClassReminderService, id, extras)
                    nextClass(this@ClassReminderService, id, end)?.let { monitor(it) }
                    removeEnded(id, alarm.optLong("alarmTime"))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                reportFailure(this@ClassReminderService, e)
            } finally {
                jobs.remove(id)
                monitoredUntil.remove(id)
                renewWakeLock()
                if (jobs.isEmpty() && !dispatchingStart) shutdown()
            }
        }
        jobs[id] = job
        job.start()
    }

    private suspend fun delayUntil(at: Long) {
        while (true) {
            val remaining = at - System.currentTimeMillis()
            if (remaining <= 0L) return
            delay(remaining)
        }
    }

    private fun savedAlarms() = JSONArray(UnifiedCache.getString(this, UnifiedCache.KEY_CLASS_ALARMS, "[]"))

    private fun savedAlarm(id: String): JSONObject? {
        val alarms = savedAlarms()
        for (i in 0 until alarms.length()) {
            val alarm = alarms.getJSONObject(i)
            if (alarm.optString("alarmId") == id) return alarm
        }
        return null
    }

    private fun isCurrent(alarm: JSONObject): Boolean {
        val current = savedAlarm(alarm.optString("alarmId")) ?: return false
        return current.optLong("alarmTime") == alarm.optLong("alarmTime") &&
            current.optLong("endAt") == alarm.optLong("endAt") &&
            current.optBoolean("liveUpdateEnabled", false) == alarm.optBoolean("liveUpdateEnabled", false) &&
            current.optBoolean("vibrationEnabled", false) == alarm.optBoolean("vibrationEnabled", false)
    }

    private fun removeEnded(id: String, alarmTime: Long) {
        val alarms = savedAlarms()
        val remaining = JSONArray()
        for (i in 0 until alarms.length()) {
            val alarm = alarms.getJSONObject(i)
            if (alarm.optString("alarmId") != id || alarm.optLong("alarmTime") != alarmTime) remaining.put(alarm)
        }
        UnifiedCache.putString(this, UnifiedCache.KEY_CLASS_ALARMS, remaining.toString())
    }

    @Synchronized
    private fun renewWakeLock() {
        val until = monitoredUntil.values.maxOrNull() ?: 0L
        val remaining = until - System.currentTimeMillis()
        wakeLock?.let { if (it.isHeld) it.release() }
        if (remaining > 0L) {
            val lock = wakeLock ?: (getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:ClassReminder").apply {
                    setReferenceCounted(false)
                    wakeLock = this
                }
            // Timeout always bounds CPU ownership to the monitored end boundary.
            lock.acquire(remaining + 5_000L)
        }
    }

    @Synchronized
    private fun shutdown() {
        if (stopped) return
        stopped = true
        foregroundReady = false
        jobs.clear()
        monitoredUntil.clear()
        scope.cancel()
        wakeLock?.let { if (it.isHeld) it.release() }
        stopForeground(STOP_FOREGROUND_DETACH)
        foregroundId = null
        stopSelf()
        if (running === this) running = null
    }

    override fun onDestroy() {
        shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
