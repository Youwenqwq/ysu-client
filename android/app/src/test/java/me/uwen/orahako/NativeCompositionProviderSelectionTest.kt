package me.uwen.orahako

import me.uwen.orahako.nativebridge.NativeCompositionProvider
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The app selects its native composition through generated build configuration;
 * this test proves the configured provider is present and implements the
 * generic provider contract without the app importing it.
 */
class NativeCompositionProviderSelectionTest {

    @Test
    fun configuredProviderClassResolvesToACompositionProvider() {
        val providerClassName = BuildConfig.NATIVE_COMPOSITION_PROVIDER
        assertTrue(providerClassName.isNotBlank())

        val type = Class.forName(providerClassName)
        assertTrue(NativeCompositionProvider::class.java.isAssignableFrom(type))

        val instanceField = type.getDeclaredField("INSTANCE").apply { isAccessible = true }
        val provider = instanceField.get(null) as NativeCompositionProvider
        assertNotNull(provider.createFactories())
    }
}
