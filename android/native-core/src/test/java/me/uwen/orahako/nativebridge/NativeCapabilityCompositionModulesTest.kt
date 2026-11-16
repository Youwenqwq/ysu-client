package me.uwen.orahako.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeCapabilityCompositionModulesTest {

    private class StubCapability(override val id: String) : NativeCapability {
        override val version: Int = 1
        override val methods: Set<String> = emptySet()

        override fun bind(): NativeCapabilityBinding =
            throw UnsupportedOperationException("not bound in this test")
    }

    private object FirstModule : NativeCapabilityCompositionModule {
        override val factories: Map<String, NativeCapabilityFactory> = mapOf(
            "test.first" to { _, _ -> StubCapability("test.first") },
        )
    }

    private object SecondModule : NativeCapabilityCompositionModule {
        override val factories: Map<String, NativeCapabilityFactory> = mapOf(
            "test.second" to { _, _ -> StubCapability("test.second") },
        )
    }

    private object DuplicateModule : NativeCapabilityCompositionModule {
        override val factories: Map<String, NativeCapabilityFactory> = mapOf(
            "test.first" to { _, _ -> StubCapability("test.first") },
        )
    }

    private class NotAModule

    @Test
    fun modulesAreLoadedByAuditableClassNameAndMerged() {
        val modules = NativeCapabilityCompositionModules.load(
            listOf(FirstModule::class.java.name, SecondModule::class.java.name),
        )

        assertEquals(
            listOf("test.first", "test.second"),
            NativeCapabilityCompositionModules.factories(modules).keys.toList(),
        )
    }

    @Test
    fun missingModuleClassFailsLoudly() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCapabilityCompositionModules.load(
                listOf("me.uwen.orahako.widget.missing.MissingComposition"),
            )
        }

        assertEquals(
            "Missing native composition module: me.uwen.orahako.widget.missing.MissingComposition",
            error.message,
        )
    }

    @Test
    fun classOutsideTheModuleContractFailsLoudly() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCapabilityCompositionModules.load(listOf(NotAModule::class.java.name))
        }

        assertEquals(
            "Native composition module ${NotAModule::class.java.name} must implement " +
                NativeCapabilityCompositionModule::class.java.name,
            error.message,
        )
    }

    @Test
    fun blankAndDuplicateModuleNamesFailLoudly() {
        val blank = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCapabilityCompositionModules.load(listOf(" "))
        }
        assertEquals("Native composition module class name must not be blank", blank.message)

        val duplicate = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCapabilityCompositionModules.load(
                listOf(FirstModule::class.java.name, FirstModule::class.java.name),
            )
        }
        assertEquals(
            "Duplicate native composition module: ${FirstModule::class.java.name}",
            duplicate.message,
        )
    }

    @Test
    fun duplicateCapabilityFactoriesFailLoudly() {
        val modules = NativeCapabilityCompositionModules.load(
            listOf(FirstModule::class.java.name, DuplicateModule::class.java.name),
        )

        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCapabilityCompositionModules.factories(modules)
        }
        assertEquals(
            "Duplicate native capability factory for enabled capability id: test.first",
            error.message,
        )
    }
}
