package me.uwen.orahako.widget.schedule

/**
 * Course color bar colors owned by the schedule companion.
 * Matches the web course-color.ts palette.
 */
object ScheduleWidgetPalette {

    private val COURSE_COLORS = intArrayOf(
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
}
