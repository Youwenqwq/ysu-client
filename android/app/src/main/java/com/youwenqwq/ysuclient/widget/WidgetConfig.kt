package com.youwenqwq.ysuclient.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent

object WidgetConfig {
    const val PREFS_NAME = "widget_schedule"
    const val KEY_COURSES = "courses_json"
    const val KEY_CURRENT_WEEK = "current_week_json"
    const val KEY_EXAMS = "exams_json"
    const val KEY_HAS_SYNCED_SCHEDULE = "has_synced_schedule"
    const val KEY_HAS_SYNCED_EXAMS = "has_synced_exams"
    const val KEY_LAST_SYNC_TIME = "last_sync_time"
    const val KEY_LAST_EXAM_SYNC_TIME = "last_exam_sync_time"
    const val KEY_SYNC_REMINDER_HOURS = "sync_reminder_hours"

    // Course color bar colors (ARGB) - matching web course-color.ts palette
    val COURSE_COLORS = intArrayOf(
        0xFF5B8FF9.toInt(), // blue
        0xFF5AD8A6.toInt(), // green
        0xFFF6BD16.toInt(), // yellow
        0xFFE8684A.toInt(), // red-orange
        0xFF6DC8EC.toInt(), // cyan
        0xFF9270CA.toInt(), // purple
        0xFFFF9D4D.toInt(), // orange
        0xFF269A99.toInt(), // teal
        0xFFFF99C3.toInt(), // pink
        0xFFBDD2FD.toInt(), // light blue
        0xFFCDDDFD.toInt(), // pale blue
        0xFFCDE8E5.toInt(), // pale teal
    )

    fun getCourseColor(name: String): Int {
        var hash = 0
        for (char in name) {
            hash = ((hash shl 5) - hash) + char.code
        }
        val index = ((hash % COURSE_COLORS.size) + COURSE_COLORS.size) % COURSE_COLORS.size
        return COURSE_COLORS[index]
    }

    /**
     * Create a PendingIntent that opens the app via a deep link.
     */
    fun createDeepLinkPendingIntent(context: Context, appWidgetId: Int, uri: String): PendingIntent {
        val clickIntent = Intent(Intent.ACTION_VIEW).apply {
            data = android.net.Uri.parse(uri)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            `package` = context.packageName
        }
        return PendingIntent.getActivity(
            context,
            appWidgetId,
            clickIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
