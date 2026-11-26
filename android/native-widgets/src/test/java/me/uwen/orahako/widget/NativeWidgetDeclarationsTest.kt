package me.uwen.orahako.widget

import android.appwidget.AppWidgetProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeWidgetDeclarationsTest {

    private fun declaration(id: String, capabilityId: String) = NativeWidgetDeclaration(
        id = id,
        providerClass = AppWidgetProvider::class.java,
        renderer = NativeWidgetRenderer { _, _, _, _ -> },
        capabilityId = capabilityId,
    )

    @Test
    fun genericHostWorksWithoutOfficialWidgetCompanions() {
        NativeWidgetDeclarations.activate(emptyList())

        assertTrue(NativeWidgetDeclarations.snapshot().isEmpty())
    }

    @Test
    fun enabledCompanionDeclarationsBecomeTheActiveSet() {
        NativeWidgetDeclarations.activate(
            listOf(
                declaration("clock", "widgets.community"),
                declaration("exam", "widgets.exam"),
            ),
        )

        assertEquals(
            listOf("clock", "exam"),
            NativeWidgetDeclarations.snapshot().map { it.id },
        )
    }

    @Test
    fun duplicateWidgetIdsAcrossCompanionsFailLoudly() {
        val error = assertThrows(IllegalArgumentException::class.java) {
            NativeWidgetDeclarations.activate(
                listOf(
                    declaration("clock", "widgets.first"),
                    declaration("clock", "widgets.second"),
                ),
            )
        }

        assertEquals("Duplicate native widget: clock", error.message)
    }
}
