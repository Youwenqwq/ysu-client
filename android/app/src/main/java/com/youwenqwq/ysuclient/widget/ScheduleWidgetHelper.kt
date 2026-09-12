package com.youwenqwq.ysuclient.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Paint
import android.widget.RemoteViews
import com.youwenqwq.ysuclient.R
import com.youwenqwq.ysuclient.cache.UnifiedCache
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class ScheduleWidgetHelper(private val context: Context, private val showTomorrow: Boolean = false) {

    data class WidgetCourse(
        val name: String,
        val classroom: String?,
        val weekDay: Int,
        val startSection: Int,
        val endSection: Int,
        val startTime: String?,
        val endTime: String?,
        val weeks: List<Int> = emptyList()
    )

    data class WidgetWeekInfo(
        val week: Int,
        val weekday: Int,
        val term: String?,
        val date: String?,
        val fullSchedule: Boolean = false
    )

    fun updateAllWidgets() {
        val appWidgetManager = AppWidgetManager.getInstance(context)
        val componentName = ComponentName(context, ScheduleWidgetProvider::class.java)
        val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)
        for (appWidgetId in appWidgetIds) {
            updateWidget(appWidgetId, appWidgetManager)
        }
        val tomorrowIds = appWidgetManager.getAppWidgetIds(
            ComponentName(context, TomorrowScheduleWidgetProvider::class.java)
        )
        if (tomorrowIds.isNotEmpty()) {
            val helper = ScheduleWidgetHelper(context, showTomorrow = true)
            for (appWidgetId in tomorrowIds) {
                helper.updateWidget(appWidgetId, appWidgetManager)
            }
        }
    }

    fun updateWidget(appWidgetId: Int, appWidgetManager: AppWidgetManager) {
        val (courses, cachedWeek, hasCachedSchedule) = loadData()
        val syncInfo = loadSyncInfo()
        // Old caches only contain this week's courses; never present them as a complete
        // next-week schedule. Opening the app migrates them through the existing bridge.
        val hasSynced = hasCachedSchedule && (!showTomorrow || cachedWeek?.fullSchedule == true) &&
            (cachedWeek?.fullSchedule != true || cachedWeek.week > 0)
        val today = Calendar.getInstance()
        val todayCourses = coursesForDate(courses, today, cachedWeek, syncInfo.lastSyncTime)
        val hasCoursesToday = !showTomorrow && todayCourses.isNotEmpty()
        var targetDay: Calendar? = if (showTomorrow) {
            (today.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, 1) }
        } else null
        var remainingCourses = when {
            !hasSynced -> emptyList()
            showTomorrow -> coursesForDate(courses, targetDay!!, cachedWeek, syncInfo.lastSyncTime)
            else -> getRemainingCourses(todayCourses)
        }
        if (!showTomorrow && hasSynced && remainingCourses.isEmpty() && loadShowNextDaySchedule()) {
            findNextDayWithCourses(courses, cachedWeek, syncInfo.lastSyncTime)?.let { (day, dayCourses) ->
                targetDay = day
                remainingCourses = dayCourses
            }
        }
        val displayWeek = weekForDate(cachedWeek, targetDay ?: today, syncInfo.lastSyncTime)
        val weekInfo = displayWeek?.let { cachedWeek?.copy(week = it) }

        val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
        val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
        val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)

        // Choose layout based on width: <180dp is small, >=180dp is medium
        val isSmall = minWidth < 180

        val views = if (isSmall) {
            buildSmallWidget(remainingCourses, weekInfo, hasCoursesToday, hasSynced, syncInfo, targetDay)
        } else if (shouldPreferSingleColumn(remainingCourses, minWidth)) {
            val courseLimit = if (minHeight >= 180) 4 else 2
            buildSingleColumnMediumWidget(remainingCourses, weekInfo, hasCoursesToday, hasSynced, syncInfo, targetDay, courseLimit)
        } else {
            buildMediumWidget(remainingCourses, weekInfo, hasCoursesToday, hasSynced, syncInfo, targetDay)
        }

        // Set click intent to open app schedule page via Deep Link
        val clickPendingIntent = WidgetConfig.createDeepLinkPendingIntent(
            context, appWidgetId, "ysuclient://schedule"
        )
        views.setOnClickPendingIntent(R.id.widget_container, clickPendingIntent)

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    data class SyncInfo(
        val hasSynced: Boolean,
        val lastSyncTime: Long,
        val syncReminderHours: Int
    )

    private fun buildSmallWidget(
        remainingCourses: List<WidgetCourse>,
        weekInfo: WidgetWeekInfo?,
        hasCoursesToday: Boolean,
        hasSynced: Boolean,
        syncInfo: SyncInfo,
        targetDay: Calendar? = null
    ): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.schedule_widget_small)

        val displayCalendar = targetDay ?: Calendar.getInstance()
        val weekdayName = getWeekdayName(displayCalendar.get(Calendar.DAY_OF_WEEK))
        views.setTextViewText(
            R.id.widget_weekday,
            if (showTomorrow) context.getString(R.string.widget_tomorrow_short) else weekdayName
        )

        if (remainingCourses.isEmpty()) {
            views.setViewVisibility(R.id.widget_single_course, android.view.View.GONE)
            views.setViewVisibility(R.id.widget_course_list, android.view.View.GONE)
            views.setViewVisibility(R.id.widget_empty_state, android.view.View.VISIBLE)

            if (hasSynced && syncInfo.lastSyncTime > 0) {
                views.setViewVisibility(R.id.widget_remaining, android.view.View.VISIBLE)
                views.setTextViewText(R.id.widget_remaining, formatSyncAge(syncInfo.lastSyncTime))
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
                formatSyncAge(syncInfo.lastSyncTime)
            } else {
                courseCountText(remainingCourses.size)
            }
            views.setTextViewText(R.id.widget_remaining, remainingText)

            if (remainingCourses.size == 1) {
                // Single course: use compact wrap_content layout
                views.setViewVisibility(R.id.widget_single_course, android.view.View.VISIBLE)
                views.setViewVisibility(R.id.widget_course_list, android.view.View.GONE)

                bindCourseItem(views, remainingCourses[0], R.id.widget_single_course, R.id.widget_single_course_color_bar, R.id.widget_single_course_name, R.id.widget_single_course_detail)
            } else {
                // Two courses: use weight-based list layout
                views.setViewVisibility(R.id.widget_single_course, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_course_list, android.view.View.VISIBLE)

                val displayCourses = remainingCourses.take(2)
                bindCourseItem(views, displayCourses.getOrNull(0), R.id.widget_course_1_container, R.id.widget_course_1_color_bar, R.id.widget_course_1_name, R.id.widget_course_1_detail)
                bindCourseItem(views, displayCourses.getOrNull(1), R.id.widget_course_2_container, R.id.widget_course_2_color_bar, R.id.widget_course_2_name, R.id.widget_course_2_detail)
            }
        }

        return views
    }

    private fun buildMediumWidget(
        remainingCourses: List<WidgetCourse>,
        weekInfo: WidgetWeekInfo?,
        hasCoursesToday: Boolean,
        hasSynced: Boolean,
        syncInfo: SyncInfo,
        targetDay: Calendar? = null
    ): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.schedule_widget_medium)
        bindMediumHeaderAndState(views, remainingCourses, weekInfo, hasCoursesToday, hasSynced, syncInfo, targetDay)

        if (remainingCourses.isNotEmpty()) {
            val displayCourses = remainingCourses.take(4)
            bindCourseItem(views, displayCourses.getOrNull(0), R.id.widget_course_1_container, R.id.widget_course_1_color_bar, R.id.widget_course_1_name, R.id.widget_course_1_detail)
            bindCourseItem(views, displayCourses.getOrNull(1), R.id.widget_course_2_container, R.id.widget_course_2_color_bar, R.id.widget_course_2_name, R.id.widget_course_2_detail)
            bindCourseItem(views, displayCourses.getOrNull(2), R.id.widget_course_3_container, R.id.widget_course_3_color_bar, R.id.widget_course_3_name, R.id.widget_course_3_detail)
            bindCourseItem(views, displayCourses.getOrNull(3), R.id.widget_course_4_container, R.id.widget_course_4_color_bar, R.id.widget_course_4_name, R.id.widget_course_4_detail)
        }

        return views
    }

    private fun buildSingleColumnMediumWidget(
        remainingCourses: List<WidgetCourse>,
        weekInfo: WidgetWeekInfo?,
        hasCoursesToday: Boolean,
        hasSynced: Boolean,
        syncInfo: SyncInfo,
        targetDay: Calendar? = null,
        courseLimit: Int = 4,
    ): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.schedule_widget_single_column)
        bindMediumHeaderAndState(views, remainingCourses, weekInfo, hasCoursesToday, hasSynced, syncInfo, targetDay)

        if (remainingCourses.isNotEmpty()) {
            val displayCourses = remainingCourses.take(courseLimit)
            bindCourseItem(views, displayCourses.getOrNull(0), R.id.widget_course_1_container, R.id.widget_course_1_color_bar, R.id.widget_course_1_name, R.id.widget_course_1_detail)
            bindCourseItem(views, displayCourses.getOrNull(1), R.id.widget_course_2_container, R.id.widget_course_2_color_bar, R.id.widget_course_2_name, R.id.widget_course_2_detail)
            bindCourseItem(views, displayCourses.getOrNull(2), R.id.widget_course_3_container, R.id.widget_course_3_color_bar, R.id.widget_course_3_name, R.id.widget_course_3_detail)
            bindCourseItem(views, displayCourses.getOrNull(3), R.id.widget_course_4_container, R.id.widget_course_4_color_bar, R.id.widget_course_4_name, R.id.widget_course_4_detail)
        }

        return views
    }

    private fun bindMediumHeaderAndState(
        views: RemoteViews,
        remainingCourses: List<WidgetCourse>,
        weekInfo: WidgetWeekInfo?,
        hasCoursesToday: Boolean,
        hasSynced: Boolean,
        syncInfo: SyncInfo,
        targetDay: Calendar? = null
    ) {
        val calendar = targetDay ?: Calendar.getInstance()
        val month = calendar.get(Calendar.MONTH) + 1
        val day = calendar.get(Calendar.DAY_OF_MONTH)
        val weekdayName = getWeekdayName(calendar.get(Calendar.DAY_OF_WEEK))
        val weekText = weekInfo?.week?.let { context.getString(R.string.widget_week_number, it) } ?: ""
        val headerText = if (weekText.isNotEmpty()) {
            "$month.$day $weekdayName · $weekText"
        } else {
            "$month.$day $weekdayName"
        }

        views.setTextViewText(
            R.id.widget_header_date,
            if (showTomorrow) context.getString(R.string.widget_tomorrow_header, headerText) else headerText
        )

        if (remainingCourses.isEmpty()) {
            views.setViewVisibility(R.id.widget_course_grid, android.view.View.GONE)
            views.setViewVisibility(R.id.widget_empty_state, android.view.View.VISIBLE)

            if (hasSynced && syncInfo.lastSyncTime > 0) {
                views.setViewVisibility(R.id.widget_header_remaining, android.view.View.VISIBLE)
                views.setTextViewText(R.id.widget_header_remaining, formatSyncAge(syncInfo.lastSyncTime))
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
                formatSyncAge(syncInfo.lastSyncTime)
            } else {
                courseCountText(remainingCourses.size)
            }
            views.setTextViewText(R.id.widget_header_remaining, remainingText)
        }
    }

    private fun courseCountText(count: Int): String = context.getString(
        if (showTomorrow) R.string.widget_tomorrow_courses else R.string.widget_remaining_courses,
        count
    )

    private fun shouldPreferSingleColumn(courses: List<WidgetCourse>, minWidthDp: Int): Boolean {
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
                detailPaint.measureText(buildCourseDetailText(course)) > textWidthPx
        }
    }

    private fun buildCourseDetailText(course: WidgetCourse): String {
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
        views: RemoteViews,
        course: WidgetCourse?,
        containerId: Int,
        colorBarId: Int,
        nameId: Int,
        detailId: Int
    ) {
        if (course == null) {
            views.setViewVisibility(containerId, android.view.View.GONE)
            return
        }

        views.setViewVisibility(containerId, android.view.View.VISIBLE)
        views.setTextViewText(nameId, course.name)

        views.setTextViewText(detailId, buildCourseDetailText(course))

        val color = WidgetConfig.getCourseColor(course.name)
        views.setInt(colorBarId, "setBackgroundColor", color)
    }

    private fun loadShowNextDaySchedule(): Boolean {
        return UnifiedCache.getBoolean(context, UnifiedCache.KEY_SHOW_NEXT_DAY_SCHEDULE, false)
    }

    /**
     * Find the next day (within 7 days) that has courses.
     * Returns a Pair of the target Calendar and that day's courses, or null if none found.
     */
    private fun findNextDayWithCourses(
        courses: List<WidgetCourse>,
        weekInfo: WidgetWeekInfo?,
        lastSyncTime: Long
    ): Pair<Calendar, List<WidgetCourse>>? {
        val target = Calendar.getInstance()
        repeat(7) {
            target.add(Calendar.DAY_OF_MONTH, 1)
            val dayCourses = coursesForDate(courses, target, weekInfo, lastSyncTime)
            if (dayCourses.isNotEmpty()) return target to dayCourses
        }
        return null
    }

    private fun loadData(): Triple<List<WidgetCourse>, WidgetWeekInfo?, Boolean> {
        val coursesJson = UnifiedCache.getCachedSchedule(context)
        val weekJson = UnifiedCache.getCachedCurrentWeek(context)
        val hasSynced = UnifiedCache.getBoolean(context, UnifiedCache.KEY_HAS_SYNCED_SCHEDULE, false)

        val courses = parseCourses(coursesJson.toString())
        val weekInfo = if (weekJson.isNotEmpty()) parseWeekInfo(weekJson) else null
        return Triple(courses, weekInfo, hasSynced)
    }

    private fun parseCourses(json: String): List<WidgetCourse> {
        return try {
            val array = JSONArray(json)
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
                    } ?: emptyList()
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun parseWeekInfo(json: String): WidgetWeekInfo? {
        return try {
            val obj = JSONObject(json)
            WidgetWeekInfo(
                week = obj.optInt("week", 0),
                weekday = obj.optInt("weekday", 0),
                term = obj.optString("term").takeIf { it.isNotEmpty() },
                date = obj.optString("date").takeIf { it.isNotEmpty() },
                fullSchedule = obj.optBoolean("full_schedule", false)
            )
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        internal fun coursesForDate(
            courses: List<WidgetCourse>,
            target: Calendar,
            weekInfo: WidgetWeekInfo?,
            lastSyncTime: Long
        ): List<WidgetCourse> {
            val weekday = mapAndroidWeekday(target.get(Calendar.DAY_OF_WEEK))
            val week = weekForDate(weekInfo, target, lastSyncTime)
            return courses.filter { course ->
                course.weekDay == weekday && (
                    weekInfo?.fullSchedule != true || course.weeks.isEmpty() ||
                        (week != null && week in course.weeks)
                    )
            }.sortedBy { it.startSection }
        }

        internal fun weekForDate(
            weekInfo: WidgetWeekInfo?,
            target: Calendar,
            lastSyncTime: Long
        ): Int? {
            if (weekInfo == null || weekInfo.week <= 0) return null
            val anchor = Calendar.getInstance(target.timeZone)
            val anchorDate = weekInfo.date?.let { value ->
                try {
                    SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply {
                        isLenient = false
                        timeZone = target.timeZone
                    }.parse(value.take(10))
                } catch (_: Exception) {
                    null
                }
            }
            if (anchorDate != null) {
                anchor.time = anchorDate
            } else if (lastSyncTime > 0) {
                anchor.timeInMillis = lastSyncTime
            } else {
                return null
            }
            val elapsedWeeks = (mondayMillis(target) - mondayMillis(anchor)) / (7 * 86_400_000L)
            return weekInfo.week + elapsedWeeks.toInt()
        }

        // Compare calendar dates in UTC so a DST transition cannot turn seven days into six.
        private fun mondayMillis(day: Calendar): Long =
            Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
                clear()
                set(day.get(Calendar.YEAR), day.get(Calendar.MONTH), day.get(Calendar.DAY_OF_MONTH))
                add(Calendar.DAY_OF_MONTH, 1 - mapAndroidWeekday(day.get(Calendar.DAY_OF_WEEK)))
            }.timeInMillis

        private fun mapAndroidWeekday(day: Int): Int = (day + 5) % 7 + 1
    }

    private fun getRemainingCourses(courses: List<WidgetCourse>): List<WidgetCourse> {
        val calendar = Calendar.getInstance()
        val currentHour = calendar.get(Calendar.HOUR_OF_DAY)
        val currentMinute = calendar.get(Calendar.MINUTE)
        val currentTimeMinutes = currentHour * 60 + currentMinute

        return courses.filter { course ->
            // Estimate end time from section number if no explicit time
            val endMinutes = if (!course.endTime.isNullOrEmpty()) {
                parseTimeToMinutes(course.endTime)
            } else {
                // Rough estimate: section 1 starts at 8:00, each section is ~45min with breaks
                // Section n ends around 8:00 + (n-1)*55 + 45 minutes
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

    private fun loadSyncInfo(): SyncInfo {
        val hasSynced = UnifiedCache.getBoolean(context, UnifiedCache.KEY_HAS_SYNCED_SCHEDULE, false)
        val lastSyncTime = UnifiedCache.getLong(context, UnifiedCache.KEY_LAST_SYNC_TIME, 0L)
        val syncReminderHours = UnifiedCache.getInt(context, UnifiedCache.KEY_SYNC_REMINDER_HOURS, 24)
        return SyncInfo(hasSynced, lastSyncTime, syncReminderHours)
    }

    private fun isSyncStale(syncInfo: SyncInfo): Boolean {
        if (!syncInfo.hasSynced || syncInfo.lastSyncTime <= 0) return false
        // 0 means always show the sync age (permanent reminder)
        if (syncInfo.syncReminderHours == 0) return true
        val elapsedMs = System.currentTimeMillis() - syncInfo.lastSyncTime
        val thresholdMs = syncInfo.syncReminderHours * 60L * 60L * 1000L
        return elapsedMs > thresholdMs
    }

    private fun formatSyncAge(lastSyncTime: Long): String {
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

    private fun getWeekdayName(dayOfWeek: Int): String {
        return context.resources.getStringArray(R.array.weekday_names)[dayOfWeek - 1]
    }
}
