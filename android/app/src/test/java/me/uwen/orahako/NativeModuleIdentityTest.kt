package me.uwen.orahako

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Guards the generic native modules against host-specific identity and against
 * app source selecting a concrete composition.
 */
class NativeModuleIdentityTest {

    private val androidRoot: File = generateSequence(File(".").absoluteFile) { it.parentFile }
        .firstOrNull { File(it, "nativeComposition.gradle").isFile }
        ?: error("android project root not found from ${File(".").absolutePath}")

    private fun nativeManifests(): List<File> =
        androidRoot.listFiles { file -> file.isDirectory && file.name.startsWith("native-") }
            .orEmpty()
            .map { File(it, "src/main/AndroidManifest.xml") }
            .filter { it.isFile }

    @Test
    fun genericModuleManifestsDoNotHardcodeTheHostActivityOrDeepLinkIdentity() {
        val manifests = nativeManifests()
        assertTrue(manifests.isNotEmpty())

        for (manifest in manifests) {
            val text = manifest.readText()
            assertFalse(
                "$manifest must not name the host activity class",
                text.contains("me.uwen.orahako.MainActivity"),
            )
            assertFalse(
                "$manifest must not hardcode orahako:// routes",
                text.contains("android:scheme=\"orahako\""),
            )
            assertFalse(
                "$manifest must not hardcode route hosts",
                Regex("""android:host="(schedule|exams|grades|settings)"""").containsMatchIn(text),
            )
        }
    }

    @Test
    fun deepLinkedModuleManifestsUsePlaceholders() {
        val linked = nativeManifests().filter {
            it.readText().contains("android.intent.action.VIEW")
        }

        assertTrue(linked.isNotEmpty())
        for (manifest in linked) {
            val text = manifest.readText()
            assertTrue("$manifest must derive the activity from applicationId",
                text.contains("\${applicationId}.MainActivity"))
            assertTrue("$manifest must derive the scheme from composition config",
                text.contains("\${orahakoDeepLinkScheme}"))
        }
    }

    @Test
    fun appBootstrapDoesNotImportAConcreteComposition() {
        val application = File(
            androidRoot,
            "app/src/main/java/me/uwen/orahako/OrahakoApplication.kt",
        )
        assertTrue(application.isFile)

        val source = application.readText()
        assertFalse(source.contains("OfficialNativeComposition"))
        assertFalse(source.contains("me.uwen.orahako.widget"))
        assertTrue(source.contains("NativeComposition.installFromProvider"))
    }
}
