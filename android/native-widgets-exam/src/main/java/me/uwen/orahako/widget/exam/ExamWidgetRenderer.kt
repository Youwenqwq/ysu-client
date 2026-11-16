package me.uwen.orahako.widget.exam

import me.uwen.orahako.widget.NativeWidgetRenderer
import me.uwen.orahako.widget.NativeWidgetState
import me.uwen.orahako.widget.WidgetConfig
import me.uwen.orahako.widget.R as WidgetR

import android.appwidget.AppWidgetManager
import android.content.Context
import android.widget.RemoteViews
import org.json.JSONArray
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * Renders the exam and exam-compact widgets from one declarative exam snapshot.
 * Layout and countdown semantics stay in this companion implementation.
 */
class ExamWidgetRenderer(private val compact: Boolean) : NativeWidgetRenderer {

    data class WidgetExam(
        val name: String,
        val examName: String?,
        val startAt: String?,
        val endAt: String?,
        val timeText: String?,
        val examLocation: String?,
        val seatNumber: String?,
    )

    private data class ExamSyncInfo(
        val hasSynced: Boolean,
        val lastSyncTime: Long,
        val syncReminderHours: Int,
    )

    override fun render(
        context: Context,
        appWidgetId: Int,
        manager: AppWidgetManager,
        state: NativeWidgetState,
    ) {
        val exams = state.snapshot?.optJSONArray("exams")?.let(::parseExams) ?: emptyList()
        val upcomingExams = filterUpcomingExams(exams)
        val totalCount = upcomingExams.size
        val nearestExam = upcomingExams.firstOrNull()
        val syncInfo = ExamSyncInfo(
            hasSynced = state.hasSnapshot,
            lastSyncTime = state.updatedAt,
            syncReminderHours = state.settings?.optInt(
                SETTING_SYNC_REMINDER_HOURS,
                DEFAULT_SYNC_REMINDER_HOURS,
            ) ?: DEFAULT_SYNC_REMINDER_HOURS,
        )

        val views = RemoteViews(
            context.packageName,
            if (compact) R.layout.exam_widget_2x2 else R.layout.exam_widget,
        )

        val headerText = nearestExam?.startAt?.let(::formatShortDate) ?: ""
        views.setTextViewText(R.id.exam_header_date, headerText)

        val headerCountText = if (nearestExam == null) {
            if (syncInfo.hasSynced && syncInfo.lastSyncTime > 0) {
                formatExamSyncAge(context, syncInfo.lastSyncTime)
            } else ""
        } else {
            if (isExamSyncStale(syncInfo)) {
                formatExamSyncAge(context, syncInfo.lastSyncTime)
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
            val displayName = if (compact && examDisplayName.length > 9) {
                examDisplayName.take(8) + "…"
            } else {
                examDisplayName
            }

            views.setTextViewText(R.id.exam_countdown_prefix, displayName)
            val daysText = if (daysRemaining == 0L) {
                context.getString(R.string.widget_exam_today)
            } else {
                daysRemaining.toString()
            }
            views.setTextViewText(R.id.exam_countdown_days, daysText)
            views.setViewVisibility(
                R.id.exam_countdown_days_label,
                if (daysRemaining == 0L) android.view.View.GONE else android.view.View.VISIBLE,
            )

            views.setTextViewText(R.id.exam_countdown_date, formatExamTimeOnly(nearestExam))
            bindExamDayDetail(views, nearestExam, daysRemaining)
        }

        views.setOnClickPendingIntent(
            R.id.exam_widget_container,
            WidgetConfig.createDeepLinkPendingIntent(
                context,
                appWidgetId,
                context.getString(R.string.orahako_widget_exam_host),
            ),
        )
        manager.updateAppWidget(appWidgetId, views)
    }

    companion object {
        private const val SETTING_SYNC_REMINDER_HOURS = "syncReminderHours"
        private const val DEFAULT_SYNC_REMINDER_HOURS = 24

        private fun computeDaysRemaining(exam: WidgetExam): Long {
            val examDate = parseLocalDateTime(exam.startAt) ?: return 0
            val now = Calendar.getInstance()
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

        private fun parseExams(array: JSONArray): List<WidgetExam> {
            return try {
                List(array.length()) { i ->
                    val obj = array.getJSONObject(i)
                    WidgetExam(
                        name = obj.optString("name", ""),
                        examName = obj.optString("exam_name").takeIf { it.isNotEmpty() },
                        startAt = obj.optString("start_at").takeIf { it.isNotEmpty() },
                        endAt = obj.optString("end_at").takeIf { it.isNotEmpty() },
                        timeText = obj.optString("time_text").takeIf { it.isNotEmpty() },
                        examLocation = obj.optString("exam_location").takeIf { it.isNotEmpty() },
                        seatNumber = obj.optString("seat_number").takeIf { it.isNotEmpty() },
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
            val match = Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?""").find(value)
                ?: return null
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

        private fun bindExamDayDetail(views: RemoteViews, exam: WidgetExam, daysRemaining: Long) {
            if (daysRemaining != 0L) {
                views.setViewVisibility(R.id.exam_countdown_detail, android.view.View.GONE)
                views.setTextViewText(R.id.exam_countdown_detail, "")
                return
            }

            val detail = buildExamDetail(exam)
            if (detail.isEmpty()) {
                views.setViewVisibility(R.id.exam_countdown_detail, android.view.View.GONE)
                views.setTextViewText(R.id.exam_countdown_detail, "")
            } else {
                views.setTextViewText(R.id.exam_countdown_detail, detail)
                views.setViewVisibility(R.id.exam_countdown_detail, android.view.View.VISIBLE)
            }
        }

        private fun buildExamDetail(exam: WidgetExam): String {
            return buildList {
                if (!exam.examLocation.isNullOrEmpty()) add(exam.examLocation)
                if (!exam.seatNumber.isNullOrEmpty()) add("#${exam.seatNumber}")
            }.joinToString(" · ")
        }

        private fun formatExamTimeOnly(exam: WidgetExam): String {
            val start = extractTime(exam.startAt)
            val end = extractTime(exam.endAt)
            return when {
                start != null && end != null -> "$start-$end"
                start != null -> start
                end != null -> end
                else -> exam.timeText ?: ""
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
                "$month.$day"
            } catch (_: Exception) {
                null
            }
        }

        private fun isExamSyncStale(syncInfo: ExamSyncInfo): Boolean {
            if (!syncInfo.hasSynced || syncInfo.lastSyncTime <= 0) return false
            if (syncInfo.syncReminderHours == 0) return true
            val elapsedMs = System.currentTimeMillis() - syncInfo.lastSyncTime
            val thresholdMs = syncInfo.syncReminderHours * 60L * 60L * 1000L
            return elapsedMs > thresholdMs
        }

        private fun formatExamSyncAge(context: Context, lastSyncTime: Long): String {
            val elapsedMs = System.currentTimeMillis() - lastSyncTime
            val elapsedHours = elapsedMs / (60 * 60 * 1000)
            return when {
                elapsedHours < 1 -> context.getString(WidgetR.string.widget_sync_just_now)
                elapsedHours < 24 -> context.getString(WidgetR.string.widget_sync_hours_ago, elapsedHours.toInt())
                else -> {
                    val elapsedDays = elapsedHours / 24
                    context.getString(WidgetR.string.widget_sync_days_ago, elapsedDays.toInt())
                }
            }
        }
    }
}
