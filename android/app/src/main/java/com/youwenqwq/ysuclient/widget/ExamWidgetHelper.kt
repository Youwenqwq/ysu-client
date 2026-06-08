package com.youwenqwq.ysuclient.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews
import com.youwenqwq.ysuclient.R
import com.youwenqwq.ysuclient.cache.UnifiedCache
import org.json.JSONArray
import java.util.Calendar
import java.util.concurrent.TimeUnit

class ExamWidgetHelper(private val context: Context) {

    data class WidgetExam(
        val name: String,
        val examName: String?,
        val startAt: String?,
        val endAt: String?,
        val timeText: String?,
        val examLocation: String?,
        val seatNumber: String?
    )

    fun updateAllWidgets() {
        val appWidgetManager = AppWidgetManager.getInstance(context)

        // Update medium widgets
        val componentName = ComponentName(context, ExamWidgetProvider::class.java)
        val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)
        for (appWidgetId in appWidgetIds) {
            updateWidget(appWidgetId, appWidgetManager)
        }

        // Update 2x2 widgets
        val twoByTwoComponentName = ComponentName(context, ExamWidget2x2Provider::class.java)
        val twoByTwoAppWidgetIds = appWidgetManager.getAppWidgetIds(twoByTwoComponentName)
        for (appWidgetId in twoByTwoAppWidgetIds) {
            update2x2Widget(appWidgetId, appWidgetManager)
        }
    }

    data class ExamSyncInfo(
        val hasSynced: Boolean,
        val lastSyncTime: Long,
        val syncReminderHours: Int
    )

    fun updateWidget(appWidgetId: Int, appWidgetManager: AppWidgetManager) {
        val exams = loadExams()
        val upcomingExams = filterUpcomingExams(exams)
        val totalCount = upcomingExams.size
        val nearestExam = upcomingExams.firstOrNull()
        val syncInfo = loadExamSyncInfo()

        val views = RemoteViews(context.packageName, R.layout.exam_widget)

        val headerText = nearestExam?.startAt?.let { formatShortDate(it) } ?: ""
        views.setTextViewText(R.id.exam_header_date, headerText)

        val headerCountText = if (nearestExam == null) {
            if (syncInfo.hasSynced && syncInfo.lastSyncTime > 0) {
                formatExamSyncAge(syncInfo.lastSyncTime)
            } else ""
        } else {
            if (isExamSyncStale(syncInfo)) {
                formatExamSyncAge(syncInfo.lastSyncTime)
            } else {
                context.getString(R.string.widget_exam_count, totalCount)
            }
        }
        views.setTextViewText(R.id.exam_header_count, headerCountText)

        if (nearestExam == null) {
            views.setViewVisibility(R.id.exam_countdown_content, android.view.View.GONE)
            views.setViewVisibility(R.id.exam_empty_state, android.view.View.VISIBLE)
            val emptyText = if (syncInfo.hasSynced) {
                context.getString(R.string.widget_exam_empty)
            } else {
                context.getString(R.string.widget_exam_empty_sync)
            }
            views.setTextViewText(R.id.exam_empty_text, emptyText)
        } else {
            views.setViewVisibility(R.id.exam_countdown_content, android.view.View.VISIBLE)
            views.setViewVisibility(R.id.exam_empty_state, android.view.View.GONE)

            val daysRemaining = computeDaysRemaining(nearestExam)
            val examDisplayName = nearestExam.name

            views.setTextViewText(R.id.exam_countdown_prefix, examDisplayName)
            val daysText = if (daysRemaining == 0L) {
                context.getString(R.string.widget_exam_today)
            } else {
                daysRemaining.toString()
            }
            views.setTextViewText(R.id.exam_countdown_days, daysText)
            views.setViewVisibility(R.id.exam_countdown_days_label,
                if (daysRemaining == 0L) android.view.View.GONE else android.view.View.VISIBLE)

            views.setTextViewText(R.id.exam_countdown_date, formatExamTime(nearestExam))
        }

        // Click to open exams page
        val clickPendingIntent = WidgetConfig.createDeepLinkPendingIntent(
            context, appWidgetId, "ysuclient://exams"
        )
        views.setOnClickPendingIntent(R.id.exam_widget_container, clickPendingIntent)

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    fun update2x2Widget(appWidgetId: Int, appWidgetManager: AppWidgetManager) {
        val exams = loadExams()
        val upcomingExams = filterUpcomingExams(exams)
        val totalCount = upcomingExams.size
        val nearestExam = upcomingExams.firstOrNull()
        val syncInfo = loadExamSyncInfo()

        val views = RemoteViews(context.packageName, R.layout.exam_widget_2x2)

        val headerText = nearestExam?.startAt?.let { formatShortDate(it) } ?: ""
        views.setTextViewText(R.id.exam_header_date, headerText)

        val headerCountText = if (nearestExam == null) {
            if (syncInfo.hasSynced && syncInfo.lastSyncTime > 0) {
                formatExamSyncAge(syncInfo.lastSyncTime)
            } else ""
        } else {
            if (isExamSyncStale(syncInfo)) {
                formatExamSyncAge(syncInfo.lastSyncTime)
            } else {
                context.getString(R.string.widget_exam_count, totalCount)
            }
        }
        views.setTextViewText(R.id.exam_header_count, headerCountText)

        if (nearestExam == null) {
            views.setViewVisibility(R.id.exam_countdown_content, android.view.View.GONE)
            views.setViewVisibility(R.id.exam_empty_state, android.view.View.VISIBLE)
            val emptyText = if (syncInfo.hasSynced) {
                context.getString(R.string.widget_exam_empty)
            } else {
                context.getString(R.string.widget_exam_empty_sync)
            }
            views.setTextViewText(R.id.exam_empty_text, emptyText)
        } else {
            views.setViewVisibility(R.id.exam_countdown_content, android.view.View.VISIBLE)
            views.setViewVisibility(R.id.exam_empty_state, android.view.View.GONE)

            val daysRemaining = computeDaysRemaining(nearestExam)
            val examDisplayName = nearestExam.name

            val shortName = if (examDisplayName.length > 9) examDisplayName.take(8) + "…" else examDisplayName
            views.setTextViewText(R.id.exam_countdown_prefix, shortName)
            val daysText2x2 = if (daysRemaining == 0L) {
                context.getString(R.string.widget_exam_today)
            } else {
                daysRemaining.toString()
            }
            views.setTextViewText(R.id.exam_countdown_days, daysText2x2)
            views.setViewVisibility(R.id.exam_countdown_days_label,
                if (daysRemaining == 0L) android.view.View.GONE else android.view.View.VISIBLE)

            views.setTextViewText(R.id.exam_countdown_date, formatExamTime(nearestExam))
        }

        // Click to open exams page
        val clickPendingIntent = WidgetConfig.createDeepLinkPendingIntent(
            context, appWidgetId, "ysuclient://exams"
        )
        views.setOnClickPendingIntent(R.id.exam_widget_container, clickPendingIntent)

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun computeDaysRemaining(exam: WidgetExam): Long {
        val examDate = parseLocalDateTime(exam.startAt) ?: return 0
        val now = Calendar.getInstance()
        // Set both to midnight for accurate day count
        now.set(Calendar.HOUR_OF_DAY, 0)
        now.set(Calendar.MINUTE, 0)
        now.set(Calendar.SECOND, 0)
        now.set(Calendar.MILLISECOND, 0)

        val examMidnight = examDate.clone() as Calendar
        examMidnight.set(Calendar.HOUR_OF_DAY, 0)
        examMidnight.set(Calendar.MINUTE, 0)
        examMidnight.set(Calendar.SECOND, 0)
        examMidnight.set(Calendar.MILLISECOND, 0)

        val diffMillis = examMidnight.timeInMillis - now.timeInMillis
        return TimeUnit.MILLISECONDS.toDays(diffMillis).coerceAtLeast(0)
    }

    private fun loadExams(): List<WidgetExam> {
        val examsJson = UnifiedCache.getCachedExams(context)
        return parseExams(examsJson.toString())
    }

    private fun parseExams(json: String): List<WidgetExam> {
        return try {
            val array = JSONArray(json)
            List(array.length()) { i ->
                val obj = array.getJSONObject(i)
                WidgetExam(
                    name = obj.optString("name", ""),
                    examName = obj.optString("exam_name").takeIf { it.isNotEmpty() },
                    startAt = obj.optString("start_at").takeIf { it.isNotEmpty() },
                    endAt = obj.optString("end_at").takeIf { it.isNotEmpty() },
                    timeText = obj.optString("time_text").takeIf { it.isNotEmpty() },
                    examLocation = obj.optString("exam_location").takeIf { it.isNotEmpty() },
                    seatNumber = obj.optString("seat_number").takeIf { it.isNotEmpty() }
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun filterUpcomingExams(exams: List<WidgetExam>): List<WidgetExam> {
        val now = Calendar.getInstance()
        return exams.filter { exam ->
            val end = parseLocalDateTime(exam.endAt) ?: parseLocalDateTime(exam.startAt)
            end?.after(now) == true
        }.sortedBy { exam ->
            parseLocalDateTime(exam.startAt)?.timeInMillis ?: Long.MAX_VALUE
        }
    }

    private fun parseLocalDateTime(value: String?): Calendar? {
        if (value.isNullOrEmpty()) return null
        val match = Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?""").find(value) ?: return null
        return try {
            val year = match.groupValues[1].toInt()
            val month = match.groupValues[2].toInt() - 1
            val day = match.groupValues[3].toInt()
            val hour = match.groupValues[4].toInt()
            val minute = match.groupValues[5].toInt()
            val second = match.groupValues.getOrNull(6)?.takeIf { it.isNotEmpty() }?.toInt() ?: 0
            Calendar.getInstance().apply {
                set(year, month, day, hour, minute, second)
                set(Calendar.MILLISECOND, 0)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun formatExamTime(exam: WidgetExam): String {
        if (!exam.timeText.isNullOrEmpty()) return exam.timeText
        val start = extractTime(exam.startAt)
        val end = extractTime(exam.endAt)
        return when {
            start != null && end != null -> "$start-$end"
            start != null -> start
            end != null -> end
            else -> ""
        }
    }

    private fun extractTime(value: String?): String? {
        if (value.isNullOrEmpty()) return null
        return Regex("""T(\d{2}:\d{2})""").find(value)?.groupValues?.getOrNull(1)
    }

    /**
     * Format exam date to short form without year.
     * e.g. "2026-05-30T18:10:00" -> "5.30"
     */
    private fun formatShortDate(startAt: String): String? {
        val match = Regex("""^(\d{4})-(\d{2})-(\d{2})""").find(startAt) ?: return null
        return try {
            val month = match.groupValues[2].toInt()
            val day = match.groupValues[3].toInt()
            "${month}.${day}"
        } catch (_: Exception) {
            null
        }
    }

    private fun loadExamSyncInfo(): ExamSyncInfo {
        val hasSynced = UnifiedCache.getBoolean(context, UnifiedCache.KEY_HAS_SYNCED_EXAMS, false)
        val lastSyncTime = UnifiedCache.getLong(context, UnifiedCache.KEY_LAST_EXAM_SYNC_TIME, 0L)
        val syncReminderHours = UnifiedCache.getInt(context, UnifiedCache.KEY_SYNC_REMINDER_HOURS, 24)
        return ExamSyncInfo(hasSynced, lastSyncTime, syncReminderHours)
    }

    private fun isExamSyncStale(syncInfo: ExamSyncInfo): Boolean {
        if (!syncInfo.hasSynced || syncInfo.lastSyncTime <= 0) return false
        if (syncInfo.syncReminderHours == 0) return true
        val elapsedMs = System.currentTimeMillis() - syncInfo.lastSyncTime
        val thresholdMs = syncInfo.syncReminderHours * 60L * 60L * 1000L
        return elapsedMs > thresholdMs
    }

    private fun formatExamSyncAge(lastSyncTime: Long): String {
        val elapsedMs = System.currentTimeMillis() - lastSyncTime
        val elapsedHours = elapsedMs / (60 * 60 * 1000)
        return when {
            elapsedHours < 1 -> context.getString(R.string.widget_sync_just_now)
            elapsedHours < 24 -> context.getString(R.string.widget_sync_hours_ago, elapsedHours.toInt())
            else -> {
                val elapsedDays = elapsedHours / 24
                context.getString(R.string.widget_sync_days_ago, elapsedDays.toInt())
            }
        }
    }
}
