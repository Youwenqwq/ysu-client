package me.uwen.orahako.widget.schedule

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class ScheduleWidgetRendererTest {
    private fun day(year: Int, month: Int, date: Int, zone: String = "Asia/Shanghai") =
        Calendar.getInstance(TimeZone.getTimeZone(zone)).apply {
            clear()
            set(year, month - 1, date, 12, 0)
        }

    private fun course(name: String, weekday: Int, section: Int, weeks: List<Int>) =
        ScheduleWidgetRenderer.WidgetCourse(
            name, "A101", weekday, section, section + 1, "08:00", "09:40", weeks,
        )

    @Test
    fun sundayToMondayUsesNextWeeksCoursesAndSectionOrder() {
        val monday = day(2026, 9, 14)
        val anchor = ScheduleWidgetRenderer.WidgetWeekInfo(1, 7, null, "2026-09-13", true)
        val courses = listOf(
            course("Odd week", 1, 1, listOf(1, 3)),
            course("Even week afternoon", 1, 5, listOf(2)),
            course("Even week morning", 1, 1, listOf(2)),
            course("Tuesday", 2, 1, listOf(2)),
        )
        assertEquals(2, ScheduleWidgetRenderer.weekForDate(anchor, monday))
        assertEquals(
            listOf("Even week morning", "Even week afternoon"),
            ScheduleWidgetRenderer.coursesForDate(courses, monday, anchor).map { it.name },
        )
    }

    @Test
    fun emptyTomorrowDoesNotBorrowAnotherWeekdayOrInactiveWeek() {
        val anchor = ScheduleWidgetRenderer.WidgetWeekInfo(1, 1, null, "2026-09-07", true)
        val tomorrow = day(2026, 9, 8)
        val courses = listOf(
            course("Next Tuesday", 2, 1, listOf(2)),
            course("Wednesday", 3, 1, listOf(1)),
        )
        assertEquals(
            emptyList<ScheduleWidgetRenderer.WidgetCourse>(),
            ScheduleWidgetRenderer.coursesForDate(courses, tomorrow, anchor),
        )
    }

    @Test
    fun yearChangeAdvancesWeekOnlyAtMonday() {
        val anchor = ScheduleWidgetRenderer.WidgetWeekInfo(8, 4, null, "2026-12-31", true)
        assertEquals(8, ScheduleWidgetRenderer.weekForDate(anchor, day(2027, 1, 1)))
        assertEquals(9, ScheduleWidgetRenderer.weekForDate(anchor, day(2027, 1, 4)))
    }

    @Test
    fun missingOrInvalidAnchorCannotShowCoursesEvenWithoutWeekRestrictions() {
        val target = day(2026, 9, 7)
        val courses = listOf(course("Unrestricted", 1, 1, emptyList()))
        val missing = ScheduleWidgetRenderer.WidgetWeekInfo(1, 1, null, null, true)
        val invalid = missing.copy(date = "2026-02-30")
        val inconsistent = missing.copy(date = "2026-09-07", weekday = 5)
        for (anchor in listOf(null, missing, invalid, inconsistent)) {
            assertEquals(
                emptyList<ScheduleWidgetRenderer.WidgetCourse>(),
                ScheduleWidgetRenderer.coursesForDate(courses, target, anchor),
            )
        }
    }

    @Test
    fun schoolMondayIsUsedWhileDeviceIsStillOnSunday() {
        val deviceSunday = day(2026, 9, 6, "America/Los_Angeles")
        val anchor = ScheduleWidgetRenderer.WidgetWeekInfo(1, 1, null, "2026-09-07", true)
        val courses = listOf(
            course("Monday", 1, 1, listOf(1)),
            course("Sunday", 7, 1, listOf(1)),
        )
        assertEquals(
            listOf("Monday"),
            ScheduleWidgetRenderer.coursesForDate(courses, deviceSunday, anchor).map { it.name },
        )
    }

    @Test
    fun semesterBoundsExcludeFutureAndPreTermCoursesIncludingUnrestrictedCourses() {
        val anchor = ScheduleWidgetRenderer.WidgetWeekInfo(2, 7, null, "2026-09-20", true, 2)
        val courses = listOf(
            course("Sunday", 7, 1, emptyList()),
            course("Monday", 1, 1, listOf(1, 2, 3)),
        )
        assertEquals(
            listOf("Sunday"),
            ScheduleWidgetRenderer.coursesForDate(courses, day(2026, 9, 20), anchor).map { it.name },
        )
        assertEquals(
            emptyList<ScheduleWidgetRenderer.WidgetCourse>(),
            ScheduleWidgetRenderer.coursesForDate(courses, day(2026, 9, 21), anchor),
        )
        assertEquals(
            emptyList<ScheduleWidgetRenderer.WidgetCourse>(),
            ScheduleWidgetRenderer.coursesForDate(courses, day(2026, 9, 6), anchor),
        )
    }

    @Test
    fun personalDatedAndWeeklyEventsMergeChronologicallyWithCoursesAndSurviveMissingAnchor() {
        val monday = day(2026, 9, 7)
        val anchor = ScheduleWidgetRenderer.WidgetWeekInfo(1, 1, null, "2026-09-07", true, 16)
        val items = listOf(
            ScheduleWidgetRenderer.WidgetCourse(
                name = "下午高数",
                classroom = "A101",
                weekDay = 1,
                startSection = 5,
                endSection = 6,
                startTime = "14:00",
                endTime = "15:40",
                weeks = listOf(1),
            ),
            ScheduleWidgetRenderer.WidgetCourse(
                name = "晨跑打卡",
                classroom = "操场",
                weekDay = 1,
                startSection = 0,
                endSection = 0,
                startTime = "07:30",
                endTime = "08:00",
                weeks = emptyList(),
                category = "personal",
            ),
            ScheduleWidgetRenderer.WidgetCourse(
                name = "项目例会",
                classroom = "线上",
                weekDay = 1,
                startSection = 0,
                endSection = 0,
                startTime = "10:00",
                endTime = "11:00",
                weeks = emptyList(),
                date = "2026-09-07",
                category = "personal",
            ),
        )

        assertEquals(
            listOf("晨跑打卡", "项目例会", "下午高数"),
            ScheduleWidgetRenderer.coursesForDate(items, monday, anchor).map { it.name },
        )
        // Without an academic anchor, personal dated & weekly items still render while academic courses stay hidden.
        assertEquals(
            listOf("晨跑打卡", "项目例会"),
            ScheduleWidgetRenderer.coursesForDate(items, monday, null).map { it.name },
        )
    }
}
