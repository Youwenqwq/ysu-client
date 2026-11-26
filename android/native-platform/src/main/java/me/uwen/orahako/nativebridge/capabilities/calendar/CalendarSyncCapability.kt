package me.uwen.orahako.nativebridge.capabilities.calendar

import android.Manifest
import android.content.ContentProviderOperation
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.CalendarContract
import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeInvokeResult
import java.util.TimeZone

internal data class IncomingCalendarEvent(
    val uid: String,
    val title: String,
    val location: String,
    val description: String,
    val startAt: Long,
    val endAt: Long,
    val remindMinutes: Int?,
) {
    val syncKey: String
        get() = "$SYNC_KEY_PREFIX$uid"

    fun fingerprint(): String =
        "$title|$location|$description|$startAt|$endAt|${remindMinutes ?: -1}"

    companion object {
        const val SYNC_KEY_PREFIX = "orahako:"
    }
}

internal fun parseIncomingCalendarEvents(raw: Any?): List<IncomingCalendarEvent>? {
    val list = raw as? List<*> ?: return null
    val parsed = ArrayList<IncomingCalendarEvent>(list.size)
    val seenUids = HashSet<String>()
    for (item in list) {
        val map = item as? Map<*, *> ?: continue
        val uid = (map["uid"] as? String)?.trim().orEmpty()
        val title = (map["title"] as? String)?.trim().orEmpty()
        val startAt = (map["startAt"] as? Number)?.toLong() ?: continue
        val endAt = (map["endAt"] as? Number)?.toLong() ?: continue
        if (uid.isEmpty() || title.isEmpty() || endAt <= startAt) continue
        if (!seenUids.add(uid)) continue
        val location = (map["location"] as? String)?.trim().orEmpty()
        val description = (map["description"] as? String)?.trim().orEmpty()
        val remindMinutes = (map["remindMinutes"] as? Number)?.toInt()?.takeIf { it > 0 }
        parsed.add(
            IncomingCalendarEvent(
                uid = uid,
                title = title,
                location = location,
                description = description,
                startAt = startAt,
                endAt = endAt,
                remindMinutes = remindMinutes,
            ),
        )
    }
    return parsed
}

/**
 * One-way schedule synchronization to the Android system calendar via
 * [CalendarContract]. Creates and owns an isolated `ACCOUNT_TYPE_LOCAL`
 * calendar so user events in other calendars are never modified.
 */
class CalendarSyncCapability(
    private val host: NativeCapabilityHost,
    override val config: Map<String, Any?>,
) : NativeCapability {

    companion object {
        const val ID = "calendar.sync"
        const val VERSION = 1

        private const val METHOD_CHECK_PERMISSIONS = "checkPermissions"
        private const val METHOD_REQUEST_PERMISSIONS = "requestPermissions"
        private const val METHOD_SYNC = "sync"
        private const val METHOD_CLEAR = "clear"

        private const val DEFAULT_ACCOUNT_NAME = "Orahako"
        private const val DEFAULT_DISPLAY_NAME = "酸橙盒 · 日程"
        private const val DEFAULT_COLOR = 0xFF2563EB.toInt()
        private const val BATCH_LIMIT = 80

        private val CALENDAR_PERMISSIONS: Array<String> = arrayOf(
            Manifest.permission.READ_CALENDAR,
            Manifest.permission.WRITE_CALENDAR,
        )
    }

    override val id: String = ID
    override val version: Int = VERSION
    override val methods: Set<String> = setOf(
        METHOD_CHECK_PERMISSIONS,
        METHOD_REQUEST_PERMISSIONS,
        METHOD_SYNC,
        METHOD_CLEAR,
    )

    override fun bind(): NativeCapabilityBinding = Binding()

    private fun accountName(): String =
        (config["accountName"] as? String)?.takeIf { it.isNotBlank() } ?: DEFAULT_ACCOUNT_NAME

    private fun defaultDisplayName(): String =
        (config["calendarDisplayName"] as? String)?.takeIf { it.isNotBlank() } ?: DEFAULT_DISPLAY_NAME

    private fun calendarColor(): Int =
        (config["calendarColor"] as? Number)?.toInt() ?: DEFAULT_COLOR

    private fun hasCalendarPermissions(): Boolean =
        CALENDAR_PERMISSIONS.all { host.hasPermission(it) }

    private inner class Binding : NativeCapabilityBinding {
        override fun invoke(
            method: String,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            when (method) {
                METHOD_CHECK_PERMISSIONS -> result.resolve(
                    mapOf("granted" to hasCalendarPermissions()),
                )
                METHOD_REQUEST_PERMISSIONS -> requestPermissions(result)
                METHOD_SYNC -> sync(payload, result)
                METHOD_CLEAR -> clear(result)
            }
        }

        override fun release() = Unit
    }

    private fun requestPermissions(result: NativeInvokeResult) {
        if (hasCalendarPermissions()) {
            result.resolve(mapOf("granted" to true))
            return
        }
        try {
            host.requestPermissions(CALENDAR_PERMISSIONS) {
                result.resolve(mapOf("granted" to hasCalendarPermissions()))
            }
        } catch (_: Exception) {
            result.resolve(mapOf("granted" to hasCalendarPermissions()))
        }
    }

    private fun sync(payload: Map<String, Any?>, result: NativeInvokeResult) {
        if (!hasCalendarPermissions()) {
            result.reject("Calendar permission not granted")
            return
        }
        val events = parseIncomingCalendarEvents(payload["events"])
        if (events == null) {
            result.reject("Missing events")
            return
        }
        val timeZone = (payload["timeZone"] as? String)?.takeIf { it.isNotBlank() }
            ?: TimeZone.getDefault().id
        val displayName = (payload["calendarName"] as? String)?.takeIf { it.isNotBlank() }
            ?: defaultDisplayName()

        try {
            val context = host.context
            val (calendarId, dedicated) = ensureTargetCalendar(context, displayName, timeZone)
            val stats = applyEventDiff(context, calendarId, dedicated, events, timeZone)
            result.resolve(
                mapOf(
                    "synced" to events.size,
                    "created" to stats.created,
                    "updated" to stats.updated,
                    "deleted" to stats.deleted,
                    "calendarId" to calendarId,
                    "dedicated" to dedicated,
                ),
            )
        } catch (error: Exception) {
            result.reject("Unable to sync schedule to system calendar", error)
        }
    }

    private fun clear(result: NativeInvokeResult) {
        if (!hasCalendarPermissions()) {
            result.resolve(mapOf("cleared" to false))
            return
        }
        try {
            val context = host.context
            val account = accountName()
            val dedicatedId = findDedicatedCalendarId(context, account)
            if (dedicatedId != null) {
                context.contentResolver.delete(
                    asSyncAdapter(CalendarContract.Calendars.CONTENT_URI, account),
                    "${CalendarContract.Calendars._ID} = ?",
                    arrayOf(dedicatedId.toString()),
                )
            }
            // Also clean any fallback events owned by us in non-dedicated calendars.
            context.contentResolver.delete(
                CalendarContract.Events.CONTENT_URI,
                "${CalendarContract.Events.SYNC_DATA1} LIKE ?",
                arrayOf("${IncomingCalendarEvent.SYNC_KEY_PREFIX}%"),
            )
            result.resolve(mapOf("cleared" to true))
        } catch (error: Exception) {
            result.reject("Unable to clear synced system calendar", error)
        }
    }

    private fun ensureTargetCalendar(
        context: Context,
        displayName: String,
        timeZone: String,
    ): Pair<Long, Boolean> {
        val account = accountName()
        findDedicatedCalendarId(context, account)?.let { existingId ->
            val values = ContentValues().apply {
                put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, displayName)
                put(CalendarContract.Calendars.VISIBLE, 1)
                put(CalendarContract.Calendars.SYNC_EVENTS, 1)
            }
            context.contentResolver.update(
                asSyncAdapter(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, existingId), account),
                values,
                null,
                null,
            )
            return existingId to true
        }

        val values = ContentValues().apply {
            put(CalendarContract.Calendars.ACCOUNT_NAME, account)
            put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            put(CalendarContract.Calendars.NAME, account)
            put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, displayName)
            put(CalendarContract.Calendars.CALENDAR_COLOR, calendarColor())
            put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER)
            put(CalendarContract.Calendars.OWNER_ACCOUNT, account)
            put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, timeZone)
            put(CalendarContract.Calendars.VISIBLE, 1)
            put(CalendarContract.Calendars.SYNC_EVENTS, 1)
        }
        val inserted = runCatching {
            context.contentResolver.insert(
                asSyncAdapter(CalendarContract.Calendars.CONTENT_URI, account),
                values,
            )?.let(ContentUris::parseId)
        }.getOrNull()
        if (inserted != null && inserted > 0L) {
            return inserted to true
        }

        val fallbackId = findWritableFallbackCalendarId(context)
            ?: throw IllegalStateException("No writable system calendar is available")
        return fallbackId to false
    }

    private fun findDedicatedCalendarId(context: Context, account: String): Long? {
        val projection = arrayOf(CalendarContract.Calendars._ID)
        val selection =
            "${CalendarContract.Calendars.ACCOUNT_NAME} = ? AND ${CalendarContract.Calendars.ACCOUNT_TYPE} = ?"
        val args = arrayOf(account, CalendarContract.ACCOUNT_TYPE_LOCAL)
        context.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            projection,
            selection,
            args,
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) return cursor.getLong(0)
        }
        return null
    }

    private fun findWritableFallbackCalendarId(context: Context): Long? {
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.IS_PRIMARY,
        )
        val selection =
            "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ? AND ${CalendarContract.Calendars.VISIBLE} = 1"
        val args = arrayOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR.toString())
        context.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            projection,
            selection,
            args,
            "${CalendarContract.Calendars.IS_PRIMARY} DESC",
        )?.use { cursor ->
            if (cursor.moveToFirst()) return cursor.getLong(0)
        }
        return null
    }

    private data class ExistingEvent(
        val id: Long,
        val syncKey: String,
        val fingerprint: String,
    )

    private data class DiffStats(
        val created: Int,
        val updated: Int,
        val deleted: Int,
    )

    private fun applyEventDiff(
        context: Context,
        calendarId: Long,
        dedicated: Boolean,
        incoming: List<IncomingCalendarEvent>,
        timeZone: String,
    ): DiffStats {
        val account = accountName()
        val eventsUri = if (dedicated) {
            asSyncAdapter(CalendarContract.Events.CONTENT_URI, account)
        } else {
            CalendarContract.Events.CONTENT_URI
        }
        val remindersUri = if (dedicated) {
            asSyncAdapter(CalendarContract.Reminders.CONTENT_URI, account)
        } else {
            CalendarContract.Reminders.CONTENT_URI
        }

        val existingByKey = LinkedHashMap<String, ExistingEvent>()
        val projection = arrayOf(
            CalendarContract.Events._ID,
            CalendarContract.Events.SYNC_DATA1,
            CalendarContract.Events.SYNC_DATA2,
        )
        val selection =
            "${CalendarContract.Events.CALENDAR_ID} = ? AND ${CalendarContract.Events.SYNC_DATA1} LIKE ? AND ${CalendarContract.Events.DELETED} = 0"
        val args = arrayOf(calendarId.toString(), "${IncomingCalendarEvent.SYNC_KEY_PREFIX}%")
        context.contentResolver.query(
            CalendarContract.Events.CONTENT_URI,
            projection,
            selection,
            args,
            null,
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val id = cursor.getLong(0)
                val key = cursor.getString(1).orEmpty()
                val fp = cursor.getString(2).orEmpty()
                if (key.isNotEmpty()) {
                    existingByKey[key] = ExistingEvent(id, key, fp)
                }
            }
        }

        val incomingByKey = incoming.associateBy { it.syncKey }
        val ops = ArrayList<ContentProviderOperation>()
        var created = 0
        var updated = 0
        var deleted = 0

        fun flushOps() {
            if (ops.isEmpty()) return
            context.contentResolver.applyBatch(CalendarContract.AUTHORITY, ArrayList(ops))
            ops.clear()
        }

        // Delete removed or changed events first (changed events are cleanly re-inserted with fresh reminders).
        for ((key, existing) in existingByKey) {
            val next = incomingByKey[key]
            if (next == null || next.fingerprint() != existing.fingerprint) {
                ops.add(
                    ContentProviderOperation.newDelete(
                        if (dedicated) {
                            asSyncAdapter(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, existing.id), account)
                        } else {
                            ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, existing.id)
                        },
                    ).build(),
                )
                if (next == null) deleted += 1 else updated += 1
                if (ops.size >= BATCH_LIMIT) flushOps()
            }
        }
        flushOps()

        // Insert new or changed events.
        for (event in incoming) {
            val existing = existingByKey[event.syncKey]
            if (existing != null && existing.fingerprint == event.fingerprint()) continue
            if (existing == null) created += 1

            val eventInsertIndex = ops.size
            ops.add(
                ContentProviderOperation.newInsert(eventsUri)
                    .withValue(CalendarContract.Events.CALENDAR_ID, calendarId)
                    .withValue(CalendarContract.Events.TITLE, event.title)
                    .withValue(CalendarContract.Events.EVENT_LOCATION, event.location)
                    .withValue(CalendarContract.Events.DESCRIPTION, event.description)
                    .withValue(CalendarContract.Events.DTSTART, event.startAt)
                    .withValue(CalendarContract.Events.DTEND, event.endAt)
                    .withValue(CalendarContract.Events.EVENT_TIMEZONE, timeZone)
                    .withValue(CalendarContract.Events.HAS_ALARM, if (event.remindMinutes != null) 1 else 0)
                    .withValue(CalendarContract.Events.SYNC_DATA1, event.syncKey)
                    .withValue(CalendarContract.Events.SYNC_DATA2, event.fingerprint())
                    .build(),
            )
            if (event.remindMinutes != null) {
                ops.add(
                    ContentProviderOperation.newInsert(remindersUri)
                        .withValueBackReference(CalendarContract.Reminders.EVENT_ID, eventInsertIndex)
                        .withValue(CalendarContract.Reminders.MINUTES, event.remindMinutes)
                        .withValue(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
                        .build(),
                )
            }
            if (ops.size >= BATCH_LIMIT) flushOps()
        }
        flushOps()

        return DiffStats(created = created, updated = updated, deleted = deleted)
    }

    private fun asSyncAdapter(uri: Uri, account: String): Uri = uri.buildUpon()
        .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, account)
        .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
        .build()
}
