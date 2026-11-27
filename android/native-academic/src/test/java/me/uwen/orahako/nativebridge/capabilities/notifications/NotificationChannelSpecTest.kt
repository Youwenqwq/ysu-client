package me.uwen.orahako.nativebridge.capabilities.notifications

import android.app.Notification
import android.app.NotificationManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationChannelSpecTest {

    @Test
    fun defaultsHighImportanceChannelsToPublicLockscreenVisibility() {
        val spec = parseChannelSpec(
            mapOf(
                "id" to "plugin.alerts",
                "name" to "Plugin Alerts",
                "importance" to "high",
            ),
        )!!
        assertEquals("plugin.alerts", spec.id)
        assertEquals("Plugin Alerts", spec.name)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, spec.importance)
        assertEquals(Notification.VISIBILITY_PUBLIC, spec.lockscreenVisibility)
    }

    @Test
    fun respectsExplicitLockscreenVisibilityAndLowImportanceDefaults() {
        val privateSpec = parseChannelSpec(
            mapOf(
                "id" to "plugin.private",
                "name" to "Private",
                "importance" to "high",
                "lockscreenVisibility" to "private",
            ),
        )!!
        assertEquals(Notification.VISIBILITY_PRIVATE, privateSpec.lockscreenVisibility)

        val lowSpec = parseChannelSpec(
            mapOf(
                "id" to "plugin.low",
                "name" to "Low",
                "importance" to "low",
                "sound" to false,
                "vibration" to false,
            ),
        )!!
        assertNull(lowSpec.lockscreenVisibility)
        assertEquals(false, lowSpec.sound)
        assertEquals(false, lowSpec.vibration)
    }

    @Test
    fun rejectsMissingIdOrName() {
        assertNull(parseChannelSpec(mapOf("id" to "", "name" to "Name")))
        assertNull(parseChannelSpec(mapOf("id" to "valid", "name" to "   ")))
    }
}
