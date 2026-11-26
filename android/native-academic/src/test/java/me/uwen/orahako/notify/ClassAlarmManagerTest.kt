package me.uwen.orahako.notify

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClassAlarmManagerTest {
    @Test
    fun liveUpdatesRequireExactAlarmAccessAndValidClassTimes() {
        val start = 1_000L
        val end = 2_000L
        assertTrue(liveUpdateEligible(true, 36, true, start, end))
        assertFalse(liveUpdateEligible(true, 36, false, start, end))
        assertFalse(liveUpdateEligible(false, 36, true, start, end))
        assertFalse(liveUpdateEligible(true, 35, true, start, end))
        assertFalse(liveUpdateEligible(true, 36, true, start, start))
    }

    @Test
    fun ordinaryRemindersStayEligibleInsidePreReminderWindowUntilStart() {
        val start = 10_000L
        val end = 20_000L
        // Inside pre-reminder window (before start): both ordinary and live are retained.
        assertTrue(alarmRetainedInSchedule(live = false, startAt = start, expiresAt = end, now = 9_000L))
        assertTrue(alarmRetainedInSchedule(live = true, startAt = start, expiresAt = end, now = 9_000L))
        // After start but before end: only live update is retained.
        assertFalse(alarmRetainedInSchedule(live = false, startAt = start, expiresAt = end, now = 15_000L))
        assertTrue(alarmRetainedInSchedule(live = true, startAt = start, expiresAt = end, now = 15_000L))
        // After end: neither is retained.
        assertFalse(alarmRetainedInSchedule(live = true, startAt = start, expiresAt = end, now = 20_000L))
    }
}
