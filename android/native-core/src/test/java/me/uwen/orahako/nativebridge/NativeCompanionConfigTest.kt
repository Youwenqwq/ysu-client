package me.uwen.orahako.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCompanionConfigTest {

    @Test
    fun versionedReferencesAreParsedIntoIdAndVersion() {
        val config = NativeCompanionConfig.parse(
            """{"version":1,"capabilities":[{"id":"native.files@2"}]}"""
        )
        assertEquals(
            NativeCompanionConfig.Entry("native.files", 2, emptyMap()),
            config.entries.single(),
        )
    }

    @Test
    fun unsupportedConfigVersionIsRejected() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCompanionConfig.parse("""{"version":2,"capabilities":[]}""")
        }
        assertTrue(error.message!!.contains("Unsupported native-companion.json version: 2"))
    }

    @Test
    fun unversionedCapabilityReferenceIsRejected() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCompanionConfig.parse("""{"version":1,"capabilities":[{"id":"file"}]}""")
        }
        assertEquals(
            "Capability id in native-companion.json must be versioned: file",
            error.message,
        )
    }

    @Test
    fun duplicateCapabilityEntryIsRejected() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCompanionConfig.parse(
                """{"version":1,"capabilities":[{"id":"native.files@1"},{"id":"native.files@1"}]}"""
            )
        }
        assertEquals("Duplicate capability in native-companion.json: native.files@1", error.message)
    }

    @Test
    fun malformedCapabilityReferenceIsRejected() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCompanionConfig.parse("""{"version":1,"capabilities":[{"id":"file@x"}]}""")
        }
        assertEquals("Invalid capability id in native-companion.json: file@x", error.message)

        assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCompanionConfig.parse("""{"version":1,"capabilities":[{"config":{}}]}""")
        }
        assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCompanionConfig.parse("""{"version":1}""")
        }
    }

    @Test
    fun requiredCompositionValuesFailLoudly() {
        val missingString = assertThrows(NativeCapabilityCompositionException::class.java) {
            emptyMap<String, Any?>().requiredString("faqUrl")
        }
        assertEquals(
            "Native companion config requires a string 'faqUrl'",
            missingString.message,
        )

        val missingInt = assertThrows(NativeCapabilityCompositionException::class.java) {
            mapOf("fullVersion" to "high").requiredInt("fullVersion")
        }
        assertEquals(
            "Native companion config requires an integer 'fullVersion'",
            missingInt.message,
        )
    }
}
