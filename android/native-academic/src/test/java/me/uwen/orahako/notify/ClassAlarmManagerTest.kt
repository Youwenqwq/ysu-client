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
}
