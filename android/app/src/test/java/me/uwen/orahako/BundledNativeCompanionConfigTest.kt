package me.uwen.orahako

import me.uwen.orahako.nativebridge.NativeCompanionConfig
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Runtime configuration of the official build.
 *
 * This test belongs to the app module because the app owns
 * `assets/native-companion.json`: it is the auditable list of enabled
 * capabilities and must stay aligned with the modules selected in
 * `nativeComposition.gradle`.
 */
class BundledNativeCompanionConfigTest {

    private fun companionAsset(): File {
        val candidates = listOf(
            File("src/main/assets/${NativeCompanionConfig.ASSET_NAME}"),
            File("app/src/main/assets/${NativeCompanionConfig.ASSET_NAME}"),
        )
        return candidates.firstOrNull { it.isFile }
            ?: error("native companion asset not found from ${File(".").absolutePath}")
    }

    @Test
    fun bundledAssetEnablesVersionedPlatformAcademicWidgetAndCompanionCapabilities() {
        val config = NativeCompanionConfig.parse(companionAsset().readText())

        assertEquals(1, config.version)
        assertEquals(
            listOf(
                "native.files@1",
                "native.webview@1",
                "native.geolocation@1",
                "notifications.core@1",
                "background.tasks@1",
                "reminders.classes@1",
                "calendar.sync@1",
                "widgets.generic@1",
                "widgets.schedule@1",
                "widgets.exam@1",
            ),
            config.entries.map { it.qualifiedId },
        )

        val file = config.entries[0]
        assertEquals("orahako_apk_update", file.config["apkDirectory"])
        assertEquals("skbird", file.config["galleryDirectory"])
        assertEquals("skbird", file.config["fileNamePrefix"])

        val webview = config.entries[1]
        assertEquals("https://orahako.welain.com/faq", webview.config["faqUrl"])
        assertEquals(111, webview.config["minimumVersion"])
        assertEquals(119, webview.config["fullVersion"])

        val geolocation = config.entries[2]
        assertEquals(15000, geolocation.config["timeoutMillis"])
        assertEquals(0, geolocation.config["maximumAgeMillis"])

        val notifications = config.entries[3]
        assertEquals(emptyMap<String, Any?>(), notifications.config)

        val backgroundTasks = config.entries[4]
        assertEquals(15, backgroundTasks.config["minimumIntervalMinutes"])
        assertEquals(60, backgroundTasks.config["defaultIntervalMinutes"])
        assertEquals("orahako_bg_task", backgroundTasks.config["workNamePrefix"])
        assertEquals("orahako_bg_task", backgroundTasks.config["tagPrefix"])

        val reminders = config.entries[5]
        assertEquals(emptyMap<String, Any?>(), reminders.config)
    }
}
