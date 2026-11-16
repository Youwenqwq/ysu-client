package me.uwen.orahako.widget.schedule

import me.uwen.orahako.widget.NativeWidgetRenderer
import me.uwen.orahako.widget.NativeWidgetState
import me.uwen.orahako.widget.WidgetConfig
import me.uwen.orahako.widget.R as WidgetR

import android.appwidget.AppWidgetManager
import android.content.Context
import android.graphics.Paint
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * Renders the schedule/tomorrow home-screen widgets from the generic widget
 * store. The renderer owns all schedule semantics; the generic host only sees
 * declarative snapshots and open widget ids.
 */
class ScheduleWidgetRenderer(private val showTomorrow: Boolean) : NativeWidgetRenderer {

    data class WidgetCourse(
        val name: String,
        val classroom: String?,
        val weekDay: Int,
        val startSection: Int,
        val endSection: Int,
        val startTime: String?,
        val endTime: String?,
        val weeks: List<Int> = emptyList(),
    )

    data class WidgetWeekInfo(
        val week: Int,
        val weekday: Int,
        val term: String?,
        val date: String?,
        val fullSchedule: Boolean = false,
        val totalWeeks: Int? = null,
    )

    override fun render(
        context: Context,
        appWidgetId: Int,
        manager: AppWidgetManager,
        state: NativeWidgetState,
    ) {
        val snapshot = state.snapshot
        val courses = snapshot?.optJSONArray("courses")?.let(::parseCourses) ?: emptyList()
        val cachedWeek = snapshot?.optJSONObject("week")?.let(::parseWeekInfo)
        val settings = state.settings
        val syncInfo = SyncInfo(
            hasSynced = state.hasSnapshot,
            lastSyncTime = state.updatedAt,
            syncReminderHours = settings?.optInt(
                SETTING_SYNC_REMINDER_HOURS,
                DEFAULT_SYNC_REMINDER_HOURS,
            ) ?: DEFAULT_SYNC_REMINDER_HOURS,
        )
        val showNextDaySchedule = settings?.optBoolean(SETTING_SHOW_NEXT_DAY, false) ?: false

        // Only complete snapshots may claim a synced state; legacy caches that
        // lack an academic anchor cannot be presented as a full schedule.
        val hasSynced = state.hasSnapshot && cachedWeek != null
        val today = schoolCalendar()
        val todayCourses = coursesForDate(courses, today, cachedWeek)
        val hasCoursesToday = !showTomorrow && todayCourses.isNotEmpty()
        var targetDay: Calendar? = if (showTomorrow) {
            (today.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, 1) }
        } else null
        var remainingCourses = when {
            !hasSynced -> emptyList()
            showTomorrow -> coursesForDate(courses, targetDay!!, cachedWeek)
            else -> getRemainingCourses(todayCourses)
        }
        if (!showTomorrow && hasSynced && remainingCourses.isEmpty() && showNextDaySchedule) {
            findNextDayWithCourses(courses, cachedWeek)?.let { (day, dayCourses) ->
                targetDay = day
                remainingCourses = dayCourses
            }
        }
        val displayWeek = weekForDate(cachedWeek, targetDay ?: today)
        val weekInfo = displayWeek?.let { cachedWeek?.copy(week = it) }

        val options = manager.getAppWidgetOptions(appWidgetId)
        val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
        val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)

        // Choose layout based on width: <180dp is small, >=180dp is medium.
        val isSmall = minWidth < 180

        val views = if (isSmall) {
            buildSmallWidget(
                context, remainingCourses, weekInfo, hasCoursesToday, hasSynced, syncInfo, targetDay,
            )
        } else if (shouldPreferSingleColumn(context, remainingCourses, minWidth)) {
            val courseLimit = if (minHeight >= 180) 4 else 2
            buildSingleColumnMediumWidget(
                context, remainingCourses, weekInfo, hasCoursesToday, hasSynced, syncInfo,
                targetDay, courseLimit,
            )
        } else {
            buildMediumWidget(
                context, remainingCourses, weekInfo, hasCoursesToday, hasSynced, syncInfo, targetDay,
            )
        }

        views.setOnClickPendingIntent(
            R.id.widget_container,
            WidgetConfig.createDeepLinkPendingIntent(
                context,
                appWidgetId,
                context.getString(R.string.orahako_widget_schedule_host),
            ),
        )
        manager.updateAppWidget(appWidgetId, views)
    }

    data class SyncInfo(
        val hasSynced: Boolean,
        val lastSyncTime: Long,
        val syncReminderHours: Int,
    )

    private fun buildSmallWidget(
        context: Context,
        remainingCourses: List<WidgetCourse>,
        weekInfo: WidgetWeekInfo?,
        hasCoursesToday: Boolean,
        hasSynced: Boolean,
        syncInfo: SyncInfo,
        targetDay: Calendar? = null,
    ): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.schedule_widget_small)

        val displayCalendar = targetDay ?: schoolCalendar()
        val weekdayName = getWeekdayName(context, displayCalendar.get(Calendar.DAY_OF_WEEK))
        views.setTextViewText(
            R.id.widget_weekday,
            if (showTomorrow) context.getString(R.string.widget_tomorrow_short) else weekdayName,
        )

        if (remainingCourses.isEmpty()) {
            views.setViewVisibility(R.id.widget_single_course, android.view.View.GONE)
            views.setViewVisibility(R.id.widget_course_list, android.view.View.GONE)
            views.setViewVisibility(R.id.widget_empty_state, android.view.View.VISIBLE)

            if (hasSynced && syncInfo.lastSyncTime > 0) {
                views.setViewVisibility(R.id.widget_remaining, android.view.View.VISIBLE)
                views.setTextViewText(
                    R.id.widget_remaining,
                    formatSyncAge(context, syncInfo.lastSyncTime),
                )
            } else {
                views.setViewVisibility(R.id.widget_remaining, android.view.View.GONE)
            }

            val emptyText = when {
                !hasSynced -> context.getString(R.string.widget_empty_sync)
                showTomorrow -> context.getString(R.string.widget_tomorrow_empty)
                hasCoursesToday -> context.getString(R.string.widget_empty_all_done)
                else -> context.getString(R.string.widget_empty_no_courses)
            }
            views.setTextViewText(R.id.widget_empty_text, emptyText)
        } else {
            views.setViewVisibility(R.id.widget_empty_state, android.view.View.GONE)
            views.setViewVisibility(R.id.widget_remaining, android.view.View.VISIBLE)

            val remainingText = if (isSyncStale(syncInfo)) {
                formatSyncAge(context, syncInfo.lastSyncTime)
            } else {
                courseCountText(context, remainingCourses.size)
            }
            views.setTextViewText(R.id.widget_remaining, remainingText)

            if (remainingCourses.size == 1) {
                views.setViewVisibility(R.id.widget_single_course, android.view.View.VISIBLE)
                views.setViewVisibility(R.id.widget_course_list, android.view.View.GONE)
                bindCourseItem(
                    context, views, remainingCourses[0],
                    R.id.widget_single_course, R.id.widget_single_course_color_bar,
                    R.id.widget_single_course_name, R.id.widget_single_course_detail,
                )
            } else {
                views.setViewVisibility(R.id.widget_single_course, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_course_list, android.view.View.VISIBLE)

                val displayCourses = remainingCourses.take(2)
                bindCourseItem(
                    context, views, displayCourses.getOrNull(0),
                    R.id.widget_course_1_container, R.id.widget_course_1_color_bar,
                    R.id.widget_course_1_name, R.id.widget_course_1_detail,
                )
                bindCourseItem(
                    context, views, displayCourses.getOrNull(1),
                    R.id.widget_course_2_container, R.id.widget_course_2_color_bar,
                    R.id.widget_course_2_name, R.id.widget_course_2_detail,
                )
            }
        }

        return views
    }

    private fun buildMediumWidget(
        context: Context,
        remainingCourses: List<WidgetCourse>,
        weekInfo: WidgetWeekInfo?,
        hasCoursesToday: Boolean,
        hasSynced: Boolean,
        syncInfo: SyncInfo,
        targetDay: Calendar? = null,
    ): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.schedule_widget_medium)
        bindMediumHeaderAndState(
            context, views, remainingCourses, weekInfo, hasCoursesToday, hasSynced, syncInfo, targetDay,
        )

        if (remainingCourses.isNotEmpty()) {
            val displayCourses = remainingCourses.take(4)
            bindCourseItem(
                context, views, displayCourses.getOrNull(0),
                R.id.widget_course_1_container, R.id.widget_course_1_color_bar,
                R.id.widget_course_1_name, R.id.widget_course_1_detail,
            )
            bindCourseItem(
                context, views, displayCourses.getOrNull(1),
                R.id.widget_course_2_container, R.id.widget_course_2_color_bar,
                R.id.widget_course_2_name, R.id.widget_course_2_detail,
            )
            bindCourseItem(
                context, views, displayCourses.getOrNull(2),
                R.id.widget_course_3_container, R.id.widget_course_3_color_bar,
                R.id.widget_course_3_name, R.id.widget_course_3_detail,
            )
            bindCourseItem(
                context, views, displayCourses.getOrNull(3),
                R.id.widget_course_4_container, R.id.widget_course_4_color_bar,
                R.id.widget_course_4_name, R.id.widget_course_4_detail,
            )
        }

        return views
    }

    private fun buildSingleColumnMediumWidget(
        context: Context,
        remainingCourses: List<WidgetCourse>,
        weekInfo: WidgetWeekInfo?,
        hasCoursesToday: Boolean,
        hasSynced: Boolean,
        syncInfo: SyncInfo,
        targetDay: Calendar? = null,
        courseLimit: Int = 4,
    ): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.schedule_widget_single_column)
        bindMediumHeaderAndState(
            context, views, remainingCourses, weekInfo, hasCoursesToday, hasSynced, syncInfo, targetDay,
        )

        if (remainingCourses.isNotEmpty()) {
            val displayCourses = remainingCourses.take(courseLimit)
            bindCourseItem(
                context, views, displayCourses.getOrNull(0),
                R.id.widget_course_1_container, R.id.widget_course_1_color_bar,
                R.id.widget_course_1_name, R.id.widget_course_1_detail,
            )
            bindCourseItem(
                context, views, displayCourses.getOrNull(1),
                R.id.widget_course_2_container, R.id.widget_course_2_color_bar,
                R.id.widget_course_2_name, R.id.widget_course_2_detail,
            )
            bindCourseItem(
                context, views, displayCourses.getOrNull(2),
                R.id.widget_course_3_container, R.id.widget_course_3_color_bar,
                R.id.widget_course_3_name, R.id.widget_course_3_detail,
            )
            bindCourseItem(
                context, views, displayCourses.getOrNull(3),
                R.id.widget_course_4_container, R.id.widget_course_4_color_bar,
                R.id.widget_course_4_name, R.id.widget_course_4_detail,
            )
        }

        return views
    }

    private fun bindMediumHeaderAndState(
        context: Context,
        views: RemoteViews,
        remainingCourses: List<WidgetCourse>,
        weekInfo: WidgetWeekInfo?,
        hasCoursesToday: Boolean,
        hasSynced: Boolean,
        syncInfo: SyncInfo,
        targetDay: Calendar? = null,
    ) {
        val calendar = targetDay ?: schoolCalendar()
        val month = calendar.get(Calendar.MONTH) + 1
        val day = calendar.get(Calendar.DAY_OF_MONTH)
        val weekdayName = getWeekdayName(context, calendar.get(Calendar.DAY_OF_WEEK))
        val weekText = weekInfo?.week?.let { context.getString(R.string.widget_week_number, it) } ?: ""
        val headerText = if (weekText.isNotEmpty()) {
            "$month.$day $weekdayName · $weekText"
        } else {
            "$month.$day $weekdayName"
        }

        views.setTextViewText(
            R.id.widget_header_date,
            if (showTomorrow) context.getString(R.string.widget_tomorrow_header, headerText) else headerText,
        )

        if (remainingCourses.isEmpty()) {
            views.setViewVisibility(R.id.widget_course_grid, android.view.View.GONE)
            views.setViewVisibility(R.id.widget_empty_state, android.view.View.VISIBLE)

            if (hasSynced && syncInfo.lastSyncTime > 0) {
                views.setViewVisibility(R.id.widget_header_remaining, android.view.View.VISIBLE)
                views.setTextViewText(
                    R.id.widget_header_remaining,
                    formatSyncAge(context, syncInfo.lastSyncTime),
                )
            } else {
                views.setViewVisibility(R.id.widget_header_remaining, android.view.View.GONE)
            }

            val emptyText = when {
                !hasSynced -> context.getString(R.string.widget_empty_sync)
                showTomorrow -> context.getString(R.string.widget_tomorrow_empty)
                hasCoursesToday -> context.getString(R.string.widget_empty_all_done)
                else -> context.getString(R.string.widget_empty_no_courses)
            }
            views.setTextViewText(R.id.widget_empty_text, emptyText)
        } else {
            views.setViewVisibility(R.id.widget_course_grid, android.view.View.VISIBLE)
            views.setViewVisibility(R.id.widget_empty_state, android.view.View.GONE)
            views.setViewVisibility(R.id.widget_header_remaining, android.view.View.VISIBLE)

            val remainingText = if (isSyncStale(syncInfo)) {
                formatSyncAge(context, syncInfo.lastSyncTime)
            } else {
                courseCountText(context, remainingCourses.size)
            }
            views.setTextViewText(R.id.widget_header_remaining, remainingText)
        }
    }

    private fun courseCountText(context: Context, count: Int): String = context.getString(
        if (showTomorrow) R.string.widget_tomorrow_courses else R.string.widget_remaining_courses,
        count,
    )

    private fun shouldPreferSingleColumn(
        context: Context,
        courses: List<WidgetCourse>,
        minWidthDp: Int,
    ): Boolean {
        if (courses.size <= 1) return false

        val twoColumnTextWidthDp = ((minWidthDp - 30) / 2f) - 27f
        if (twoColumnTextWidthDp <= 0f) return true

        val density = context.resources.displayMetrics.density
        val textWidthPx = twoColumnTextWidthDp * density
        val namePaint = Paint().apply {
            isFakeBoldText = true
            textSize = 13f * context.resources.displayMetrics.density * context.resources.configuration.fontScale
        }
        val detailPaint = Paint().apply {
            textSize = 11f * context.resources.displayMetrics.density * context.resources.configuration.fontScale
        }

        return courses.take(4).any { course ->
            namePaint.measureText(course.name) > textWidthPx ||
                detailPaint.measureText(buildCourseDetailText(context, course)) > textWidthPx
        }
    }

    private fun buildCourseDetailText(context: Context, course: WidgetCourse): String {
        val timeText = if (!course.startTime.isNullOrEmpty() && !course.endTime.isNullOrEmpty()) {
            "${course.startTime} - ${course.endTime}"
        } else {
            context.getString(R.string.widget_section_format, course.startSection, course.endSection)
        }

        return if (!course.classroom.isNullOrEmpty()) {
            "$timeText  ${course.classroom}"
        } else {
            timeText
        }
    }

    private fun bindCourseItem(
        context: Context,
        views: RemoteViews,
        course: WidgetCourse?,
        containerId: Int,
        colorBarId: Int,
        nameId: Int,
        detailId: Int,
    ) {
        if (course == null) {
            views.setViewVisibility(containerId, android.view.View.GONE)
            return
        }

        views.setViewVisibility(containerId, android.view.View.VISIBLE)
        views.setTextViewText(nameId, course.name)
        views.setTextViewText(detailId, buildCourseDetailText(context, course))
        views.setInt(colorBarId, "setBackgroundColor", ScheduleWidgetPalette.getCourseColor(course.name))
    }

    /**
     * Find the next day (within 7 days) that has courses.
     * Returns a Pair of the target Calendar and that day's courses, or null.
     */
    private fun findNextDayWithCourses(
        courses: List<WidgetCourse>,
        weekInfo: WidgetWeekInfo?,
    ): Pair<Calendar, List<WidgetCourse>>? {
        val target = schoolCalendar()
        repeat(7) {
            target.add(Calendar.DAY_OF_MONTH, 1)
            val dayCourses = coursesForDate(courses, target, weekInfo)
            if (dayCourses.isNotEmpty()) return target to dayCourses
        }
        return null
    }

    private fun parseCourses(array: JSONArray): List<WidgetCourse> {
        return try {
            List(array.length()) { i ->
                val obj = array.getJSONObject(i)
                WidgetCourse(
                    name = obj.optString("name", ""),
                    classroom = obj.optString("classroom").takeIf { it.isNotEmpty() },
                    weekDay = obj.optInt("week_day", 0),
                    startSection = obj.optInt("start_section", 0),
                    endSection = obj.optInt("end_section", 0),
                    startTime = obj.optString("start_time").takeIf { it.isNotEmpty() },
                    endTime = obj.optString("end_time").takeIf { it.isNotEmpty() },
                    weeks = obj.optJSONArray("week_list")?.let { weeks ->
                        List(weeks.length()) { weeks.getInt(it) }
                    } ?: emptyList(),
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun parseWeekInfo(obj: JSONObject): WidgetWeekInfo? {
        return try {
            WidgetWeekInfo(
                week = obj.optInt("week", 0),
                weekday = obj.optInt("weekday", 0),
                term = obj.optString("term").takeIf { it.isNotEmpty() },
                date = obj.optString("date").takeIf { it.isNotEmpty() },
                fullSchedule = obj.optBoolean("full_schedule", false),
                totalWeeks = if (obj.has("total_weeks")) obj.optInt("total_weeks") else null,
            )
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val SETTING_SYNC_REMINDER_HOURS = "syncReminderHours"
        private const val SETTING_SHOW_NEXT_DAY = "showNextDaySchedule"
        private const val DEFAULT_SYNC_REMINDER_HOURS = 24

        private val schoolTimeZone = TimeZone.getTimeZone("Asia/Shanghai")
        private val datePattern = Regex("\\d{4}-\\d{2}-\\d{2}")

        internal fun schoolCalendar(timeInMillis: Long = System.currentTimeMillis()): Calendar =
            Calendar.getInstance(schoolTimeZone).apply { this.timeInMillis = timeInMillis }

        internal fun coursesForDate(
            courses: List<WidgetCourse>,
            target: Calendar,
            weekInfo: WidgetWeekInfo?,
        ): List<WidgetCourse> {
            val day = schoolCalendar(target.timeInMillis)
            val weekday = mapAndroidWeekday(day.get(Calendar.DAY_OF_WEEK))
            val week = weekForDate(weekInfo, day) ?: return emptyList()
            // Legacy caches contain only the anchor week's courses.
            if (weekInfo?.fullSchedule != true && week != weekInfo?.week) return emptyList()
            return courses.filter { course ->
                course.weekDay == weekday && (course.weeks.isEmpty() || week in course.weeks)
            }.sortedBy { it.startSection }
        }

        internal fun weekForDate(weekInfo: WidgetWeekInfo?, target: Calendar): Int? {
            if (weekInfo == null || weekInfo.week <= 0 || weekInfo.weekday !in 1..7) return null
            val value = weekInfo.date ?: return null
            if (!datePattern.matches(value)) return null
            val anchorDate = try {
                SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply {
                    isLenient = false
                    timeZone = schoolTimeZone
                }.parse(value)
            } catch (_: Exception) {
                null
            } ?: return null
            val anchor = schoolCalendar(anchorDate.time)
            if (mapAndroidWeekday(anchor.get(Calendar.DAY_OF_WEEK)) != weekInfo.weekday) return null
            val day = schoolCalendar(target.timeInMillis)
            val elapsedDays = (dateMillis(day) - dateMillis(anchor)) / 86_400_000L
            val elapsedWeeks = Math.floorDiv(elapsedDays + weekInfo.weekday - 1, 7L)
            val week = weekInfo.week + elapsedWeeks.toInt()
            return week.takeIf { it >= 1 && (weekInfo.totalWeeks == null || it <= weekInfo.totalWeeks) }
        }

        // Compare calendar dates in UTC so a DST transition cannot turn seven days into six.
        private fun dateMillis(day: Calendar): Long =
            Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
                clear()
                set(day.get(Calendar.YEAR), day.get(Calendar.MONTH), day.get(Calendar.DAY_OF_MONTH))
            }.timeInMillis

        private fun mapAndroidWeekday(day: Int): Int = (day + 5) % 7 + 1

        private fun getRemainingCourses(courses: List<WidgetCourse>): List<WidgetCourse> {
            val calendar = schoolCalendar()
            val currentTimeMinutes =
                calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)

            return courses.filter { course ->
                // Estimate end time from section number if no explicit time.
                val endMinutes = if (!course.endTime.isNullOrEmpty()) {
                    parseTimeToMinutes(course.endTime)
                } else {
                    // Section n ends around 8:00 + (n-1)*55 + 45 minutes.
                    8 * 60 + (course.endSection - 1) * 55 + 45
                }
                endMinutes == null || currentTimeMinutes < endMinutes
            }
        }

        private fun parseTimeToMinutes(timeStr: String): Int? {
            return try {
                val parts = timeStr.split(":")
                if (parts.size >= 2) {
                    parts[0].toInt() * 60 + parts[1].toInt()
                } else null
            } catch (_: Exception) {
                null
            }
        }

        private fun isSyncStale(syncInfo: SyncInfo): Boolean {
            if (!syncInfo.hasSynced || syncInfo.lastSyncTime <= 0) return false
            // 0 means always show the sync age (permanent reminder).
            if (syncInfo.syncReminderHours == 0) return true
            val elapsedMs = System.currentTimeMillis() - syncInfo.lastSyncTime
            val thresholdMs = syncInfo.syncReminderHours * 60L * 60L * 1000L
            return elapsedMs > thresholdMs
        }

        private fun formatSyncAge(context: Context, lastSyncTime: Long): String {
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

        private fun getWeekdayName(context: Context, dayOfWeek: Int): String =
            context.resources.getStringArray(R.array.weekday_names)[dayOfWeek - 1]
    }
}
