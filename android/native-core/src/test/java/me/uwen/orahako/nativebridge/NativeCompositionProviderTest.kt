package me.uwen.orahako.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeCompositionProviderTest {

    private object TestProvider : NativeCompositionProvider {
        private val factories = object : NativeCapabilityFactories {
            override fun create(
                host: NativeCapabilityHost,
                entries: List<NativeCompanionConfig.Entry>,
            ): List<NativeCapability> = emptyList()
        }

        override fun createFactories(): NativeCapabilityFactories = factories
    }

    private class NotAProvider

    @Test
    fun providerIsInstalledFromItsAuditableClassName() {
        NativeComposition.installFromProvider(TestProvider::class.java.name)

        assertSame(TestProvider.createFactories(), NativeComposition.require())
    }

    @Test
    fun blankProviderFailsLoudly() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeComposition.installFromProvider("  ")
        }

        assertEquals(
            "Native composition provider is not configured for this build",
            error.message,
        )
    }

    @Test
    fun missingProviderClassFailsLoudly() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeComposition.installFromProvider("me.uwen.orahako.missing.NativeComposition")
        }

        assertEquals(
            "Missing native composition provider: me.uwen.orahako.missing.NativeComposition",
            error.message,
        )
    }

    @Test
    fun classOutsideTheProviderContractFailsLoudly() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeComposition.installFromProvider(NotAProvider::class.java.name)
        }

        assertEquals(
            "Native composition provider ${NotAProvider::class.java.name} must implement " +
                NativeCompositionProvider::class.java.name,
            error.message,
        )
    }
}
