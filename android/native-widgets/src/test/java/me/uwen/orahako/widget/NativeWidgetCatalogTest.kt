package me.uwen.orahako.widget

import android.appwidget.AppWidgetProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeWidgetCatalogTest {

    private fun declaration(id: String, capabilityId: String = "widgets.test") =
        NativeWidgetDeclaration(
            id = id,
            providerClass = AppWidgetProvider::class.java,
            renderer = NativeWidgetRenderer { _, _, _, _ -> },
            capabilityId = capabilityId,
        )

    @Test
    fun resolvesOpenStringWidgetIds() {
        val catalog = NativeWidgetCatalog(
            listOf(
                declaration("schedule", "widgets.schedule"),
                declaration("community.clock", "widgets.community"),
            ),
        )

        assertEquals("widgets.community", catalog.resolve("community.clock").capabilityId)
        assertEquals(listOf("schedule", "community.clock"), catalog.widgetIds())
    }

    @Test
    fun unknownWidgetIdFailsDeterministically() {
        val catalog = NativeWidgetCatalog(listOf(declaration("schedule")))

        val error = assertThrows(UnknownNativeWidgetException::class.java) {
            catalog.resolve("unowned")
        }
        assertEquals("Unknown native widget: unowned", error.message)
    }

    @Test
    fun duplicateWidgetIdsAreRejected() {
        val catalog = NativeWidgetCatalog(listOf(declaration("clock")))

        val error = assertThrows(IllegalArgumentException::class.java) {
            catalog.register(declaration("clock", "widgets.other"))
        }
        assertEquals("Duplicate native widget: clock", error.message)
    }

    @Test
    fun disabledOrUnownedWidgetsArePruned() {
        assertEquals(
            setOf("exam", "exam-compact", "community.clock"),
            staleWidgetIds(
                stored = setOf("schedule", "exam", "exam-compact", "community.clock"),
                declared = listOf("schedule"),
            ),
        )
    }
}
