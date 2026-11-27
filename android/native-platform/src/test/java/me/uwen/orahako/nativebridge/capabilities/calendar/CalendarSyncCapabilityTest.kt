package me.uwen.orahako.nativebridge.capabilities.calendar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CalendarSyncCapabilityTest {

    @Test
    fun parsesValidIncomingEventsAndDeduplicatesByUid() {
        val raw = listOf(
            mapOf(
                "uid" to "course:1",
                "title" to "高等数学",
                "location" to "A101",
                "description" to "张老师",
                "startAt" to 1_000L,
                "endAt" to 2_000L,
                "remindMinutes" to 15,
            ),
            // Duplicate uid should be ignored
            mapOf(
                "uid" to "course:1",
                "title" to "重复课程",
                "startAt" to 1_000L,
                "endAt" to 2_000L,
            ),
            // Invalid endAt <= startAt should be skipped
            mapOf(
                "uid" to "bad:1",
                "title" to "无效时间",
                "startAt" to 2_000L,
                "endAt" to 2_000L,
            ),
            mapOf(
                "uid" to "entry:2",
                "title" to "社团例会",
                "startAt" to 3_000L,
                "endAt" to 4_000L,
                "remindMinutes" to 0,
            ),
        )

        val events = parseIncomingCalendarEvents(raw)!!
        assertEquals(2, events.size)
        assertEquals("orahako:default:course:1", events[0].syncKey)
        assertEquals(15, events[0].remindMinutes)
        assertNull(events[1].remindMinutes)
    }

    @Test
    fun isolatesSyncKeysByNormalizedNamespace() {
        val raw = listOf(
            mapOf(
                "uid" to "exam-1",
                "title" to "期末考试",
                "startAt" to 1_000L,
                "endAt" to 2_000L,
            ),
        )

        val scheduleEvents = parseIncomingCalendarEvents(raw, "orahako.schedule")!!
        val clubEvents = parseIncomingCalendarEvents(raw, "community:club/events")!!
        val blankEvents = parseIncomingCalendarEvents(raw, "   ")!!

        assertEquals("orahako:orahako.schedule:exam-1", scheduleEvents[0].syncKey)
        assertEquals("orahako:community_club_events:exam-1", clubEvents[0].syncKey)
        assertEquals("orahako:default:exam-1", blankEvents[0].syncKey)
    }

    @Test
    fun returnsNullWhenEventsPayloadIsMissing() {
        assertNull(parseIncomingCalendarEvents(null))
        assertNull(parseIncomingCalendarEvents("not-a-list"))
    }
}
