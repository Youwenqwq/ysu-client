package me.uwen.orahako.nativebridge.official

import android.app.Activity
import android.content.Context
import me.uwen.orahako.nativebridge.NativeCapabilityCompositionException
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeCapabilityRegistry
import me.uwen.orahako.nativebridge.NativeCompanionConfig
import me.uwen.orahako.nativebridge.capabilities.polling.BackgroundTaskHandlers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class OfficialNativeCompositionTest {

    private class UnusedHost : NativeCapabilityHost {
        override val context: Context
            get() = error("context is not read while composing capabilities")
        override val activity: Activity?
            get() = null

        override fun hasPermission(permission: String): Boolean =
            error("permissions are not read while composing capabilities")

        override fun requestPermissions(
            permissions: Array<String>,
            onResult: (Boolean) -> Unit,
        ) = error("permissions are not read while composing capabilities")

        override fun runOnUiThread(action: () -> Unit) = error("UI is not used while composing")

        override fun evaluateJavascript(script: String) =
            error("JavaScript is not used while composing")

        override fun emit(capabilityId: String, event: String, data: Map<String, Any?>) =
            error("events are not emitted while composing")
    }

    private val entries = listOf(
        NativeCompanionConfig.Entry(
            "native.files",
            1,
            mapOf(
                "apkDirectory" to "apk",
                "galleryDirectory" to "gallery",
                "fileNamePrefix" to "image",
            ),
        ),
        NativeCompanionConfig.Entry(
            "native.webview",
            1,
            mapOf(
                "faqUrl" to "https://example.test/help",
                "minimumVersion" to 100,
                "fullVersion" to 110,
            ),
        ),
    )

    @Test
    fun theOfficialObjectIsTheBuildSelectedCompositionProvider() {
        assertSame(OfficialNativeComposition, OfficialNativeComposition.createFactories())
    }

    @Test
    fun generatedCompositionModuleListMatchesTheSelectedWidgetCompanions() {
        assertEquals(
            listOf(
                "me.uwen.orahako.widget.schedule.ScheduleWidgetComposition",
                "me.uwen.orahako.widget.exam.ExamWidgetComposition",
            ),
            BuildConfig.NATIVE_CAPABILITY_COMPOSITION_MODULES.split(','),
        )
    }

    @Test
    fun officialFactoriesProduceTheEnabledCapabilitiesInConfigOrder() {
        val capabilities = OfficialNativeComposition.create(UnusedHost(), entries)
        val registry = NativeCapabilityRegistry(capabilities)

        assertEquals(listOf("native.files", "native.webview"), registry.describe().map { it.id })
        assertEquals(listOf(1, 1), registry.describe().map { it.version })
        assertEquals(
            listOf("clearDirectory", "downloadApk", "exportTextFile", "installApk", "saveImageToGallery"),
            registry.describe()[0].methods,
        )
        assertEquals(listOf("check", "initSafeArea"), registry.describe()[1].methods)
        assertEquals("https://example.test/help", registry.describe()[1].config["faqUrl"])
    }

    @Test
    fun unknownEnabledCapabilityFailsWithTheAuditableId() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            OfficialNativeComposition.create(
                UnusedHost(),
                listOf(NativeCompanionConfig.Entry("missing", 1, emptyMap())),
            )
        }
        assertEquals(
            "No native factory for enabled capability: missing@1",
            error.message,
        )
    }

    @Test
    fun configVersionMustMatchTheFactoryVersion() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            OfficialNativeComposition.create(
                UnusedHost(),
                listOf(entries[0].copy(version = 2)),
            )
        }
        assertEquals(
            "Native factory mismatch: native.files@2 produced native.files@1",
            error.message,
        )
    }

    @Test
    fun companionCapabilitiesAreComposedWithoutReadingTheHostContext() {
        val companionEntries = entries + listOf(
            NativeCompanionConfig.Entry("notifications.core", 1, emptyMap()),
            NativeCompanionConfig.Entry(
                "academic.polling",
                1,
                mapOf("minimumIntervalMinutes" to 15, "defaultIntervalMinutes" to 60),
            ),
            NativeCompanionConfig.Entry("reminders.classes", 1, emptyMap()),
        )

        val registry = NativeCapabilityRegistry(OfficialNativeComposition.create(UnusedHost(), companionEntries))
        val byId = registry.describe().associateBy { it.id }

        assertEquals(
            listOf(
                "cancelAll",
                "checkBatteryOptimization",
                "checkExactAlarmPermission",
                "checkPermissions",
                "ensureChannel",
                "openAutoStartSettings",
                "openNotificationSettings",
                "requestExactAlarmPermission",
                "requestIgnoreBatteryOptimization",
                "requestPermissions",
            ),
            byId.getValue("notifications.core").methods,
        )
        assertEquals(
            listOf("configure", "inspect", "pause", "resume", "runNow", "status", "stop"),
            byId.getValue("academic.polling").methods,
        )
        assertEquals(
            listOf("cancel", "debug", "schedule"),
            byId.getValue("reminders.classes").methods,
        )
    }

    @Test
    fun officialCompositionRegistersTheYsuAdapterForScheduledWork() {
        BackgroundTaskHandlers.clear()
        try {
            OfficialNativeComposition.installBackgroundTaskHandlers()
            assertSame(
                me.uwen.orahako.companion.ysu.YsuBackgroundTaskHandler,
                BackgroundTaskHandlers.find("ysu"),
            )
        } finally {
            BackgroundTaskHandlers.clear()
        }
    }
}
