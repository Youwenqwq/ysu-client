package me.uwen.orahako.notify

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClassLiveUpdateTest {
    @Test
    fun nextClassWaitsForTheActiveClassToEnd() {
        val currentStart = 10_000L
        val currentEnd = 20_000L
        val nextStart = 25_000L
        assertTrue(shouldDeferLiveUpdate(15_000L, nextStart, currentStart, currentEnd))
        assertFalse(shouldDeferLiveUpdate(currentEnd, nextStart, currentStart, currentEnd))
    }

    @Test
    fun upcomingOrInvalidActiveClassDoesNotBlockAnotherReminder() {
        val now = 15_000L
        val nextStart = 25_000L
        assertFalse(shouldDeferLiveUpdate(now, nextStart, 20_000L, 30_000L))
        assertFalse(shouldDeferLiveUpdate(now, nextStart, 0L, 30_000L))
        assertFalse(shouldDeferLiveUpdate(now, now, 10_000L, 20_000L))
    }
}
