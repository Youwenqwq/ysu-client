package me.uwen.orahako.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCapabilityRegistryTest {

    private class RecordingBinding(
        private val autoResolve: Boolean = true,
        private val throwOnInvoke: Boolean = false,
    ) : NativeCapabilityBinding {
        data class Call(val method: String, val payload: Map<String, Any?>)

        val calls = mutableListOf<Call>()
        var releases = 0
        var pending: NativeInvokeResult? = null

        override fun invoke(
            method: String,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            calls.add(Call(method, payload))
            if (throwOnInvoke) throw IllegalStateException("boom")
            pending = result
            if (autoResolve) result.resolve(mapOf("method" to method))
        }

        override fun release() {
            releases += 1
        }
    }

    private class FakeCapability(
        override val id: String,
        override val version: Int = 1,
        override val methods: Set<String> = setOf("ping"),
        override val dependencies: List<String> = emptyList(),
        override val config: Map<String, Any?> = emptyMap(),
        private val binding: RecordingBinding = RecordingBinding(),
    ) : NativeCapability {
        var binds = 0
        val activeBinding: RecordingBinding
            get() = binding

        override fun bind(): NativeCapabilityBinding {
            binds += 1
            return binding
        }
    }

    private class RecordingResult : NativeInvokeResult {
        var value: Any? = null
        var failure: String? = null
        var settles = 0

        override fun resolve(value: Any?) {
            settles += 1
            this.value = value
        }

        override fun reject(message: String, cause: Throwable?) {
            settles += 1
            failure = message
        }
    }

    @Test
    fun describeOrdersDependenciesFirstAndExposesQualifiedReferences() {
        val dependency = FakeCapability("alpha", methods = setOf("zeta", "ping"))
        val dependent = FakeCapability("beta", dependencies = listOf("alpha"))
        val independent = FakeCapability("gamma")

        val registry = NativeCapabilityRegistry(listOf(dependent, independent, dependency))
        val descriptors = registry.describe()

        assertEquals(listOf("alpha", "beta", "gamma"), descriptors.map { it.id })
        assertEquals(listOf("ping", "zeta"), descriptors[0].methods)
        assertEquals(listOf("alpha@1"), descriptors[1].dependencies)
        assertEquals("beta@1", descriptors[1].qualifiedId)
    }

    @Test
    fun duplicateCapabilityIdIsRejected() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCapabilityRegistry(
                listOf(FakeCapability("alpha"), FakeCapability("alpha", version = 2))
            )
        }
        assertTrue(error.message!!.startsWith("Duplicate native capability: alpha@"))
    }

    @Test
    fun missingDependencyIsRejected() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCapabilityRegistry(
                listOf(FakeCapability("beta", dependencies = listOf("missing")))
            )
        }
        assertEquals(
            "Native capability beta@1 depends on missing capability missing",
            error.message,
        )
    }

    @Test
    fun dependencyVersionMismatchIsRejected() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCapabilityRegistry(
                listOf(
                    FakeCapability("alpha"),
                    FakeCapability("beta", dependencies = listOf("alpha@2")),
                )
            )
        }
        assertEquals(
            "Native capability beta@1 depends on unavailable version alpha@2 " +
                "(available: alpha@1)",
            error.message,
        )
    }

    @Test
    fun dependencyCycleIsRejectedWithTheCyclePath() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCapabilityRegistry(
                listOf(
                    FakeCapability("alpha", dependencies = listOf("beta")),
                    FakeCapability("beta", dependencies = listOf("alpha")),
                )
            )
        }
        assertEquals("Native capability dependency cycle: alpha -> beta -> alpha", error.message)
    }

    @Test
    fun selfDependencyIsRejected() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCapabilityRegistry(
                listOf(FakeCapability("alpha", dependencies = listOf("alpha")))
            )
        }
        assertEquals("Native capability dependency cycle: alpha -> alpha", error.message)
    }

    @Test
    fun duplicateDependencyDeclarationIsRejected() {
        val error = assertThrows(NativeCapabilityCompositionException::class.java) {
            NativeCapabilityRegistry(
                listOf(
                    FakeCapability("alpha"),
                    FakeCapability("beta", dependencies = listOf("alpha", "alpha@1")),
                )
            )
        }
        assertEquals(
            "Duplicate dependency alpha@1 of native capability beta@1",
            error.message,
        )
    }

    @Test
    fun acquireBindsDependenciesFirstAndReleaseOwnsThem() {
        val dependency = FakeCapability("alpha")
        val dependent = FakeCapability("beta", dependencies = listOf("alpha"))
        val registry = NativeCapabilityRegistry(listOf(dependent, dependency))

        val lease = registry.acquire("beta@1")

        assertEquals(1, dependency.binds)
        assertEquals(1, dependent.binds)
        assertEquals(1, registry.activeReferences("alpha"))
        assertEquals(1, registry.activeReferences("beta"))
        assertEquals(listOf("alpha@1"), lease.dependencies)

        assertTrue(registry.release(lease.token))
        assertEquals(1, dependent.activeBinding.releases)
        assertEquals(1, dependency.activeBinding.releases)
        assertEquals(0, registry.activeReferences("alpha"))
        assertEquals(0, registry.activeReferences("beta"))
    }

    @Test
    fun sharedDependencyStaysBoundUntilLastDependentReleases() {
        val shared = FakeCapability("alpha")
        val first = FakeCapability("beta", dependencies = listOf("alpha"))
        val second = FakeCapability("gamma", dependencies = listOf("alpha"))
        val registry = NativeCapabilityRegistry(listOf(shared, first, second))

        val firstLease = registry.acquire("beta")
        val secondLease = registry.acquire("gamma")

        assertEquals(1, shared.binds)
        assertEquals(2, registry.activeReferences("alpha"))

        registry.release(firstLease.token)
        assertEquals(0, shared.activeBinding.releases)
        assertEquals(1, registry.activeReferences("alpha"))

        registry.release(secondLease.token)
        assertEquals(1, shared.activeBinding.releases)
        assertEquals(0, registry.activeReferences("alpha"))
    }

    @Test
    fun explicitLeasesAreReferenceCountedAndReleaseIsIdempotent() {
        val capability = FakeCapability("alpha")
        val registry = NativeCapabilityRegistry(listOf(capability))

        val first = registry.acquire("alpha")
        val second = registry.acquire("alpha")
        assertEquals(1, capability.binds)
        assertEquals(2, registry.activeReferences("alpha"))

        assertTrue(registry.release(first.token))
        assertEquals(0, capability.activeBinding.releases)
        assertFalse(registry.release(first.token))
        assertEquals(0, capability.activeBinding.releases)

        assertTrue(registry.release(second.token))
        assertFalse(registry.release(second.token))
        assertEquals(1, capability.activeBinding.releases)
        assertEquals(0, registry.activeReferences("alpha"))
    }

    @Test
    fun unknownCapabilityReferencesFailDeterministically() {
        val registry = NativeCapabilityRegistry(listOf(FakeCapability("alpha")))

        assertEquals(
            "Unknown native capability: missing",
            assertThrows(UnknownNativeCapabilityException::class.java) {
                registry.acquire("missing")
            }.message,
        )
        assertEquals(
            "Unknown native capability: alpha@2",
            assertThrows(UnknownNativeCapabilityException::class.java) {
                registry.acquire("alpha@2")
            }.message,
        )
        assertFalse(registry.has("alpha@2"))
        assertTrue(registry.has("alpha@1"))
        assertTrue(registry.has("alpha"))
    }

    @Test
    fun unknownMethodFailsBeforeBinding() {
        val capability = FakeCapability("alpha", methods = setOf("ping"))
        val registry = NativeCapabilityRegistry(listOf(capability))
        val result = RecordingResult()

        assertEquals(
            "Unknown native capability method: alpha.pong",
            assertThrows(UnknownNativeCapabilityMethodException::class.java) {
                registry.invoke("alpha", "pong", emptyMap(), result)
            }.message,
        )
        assertEquals(0, capability.binds)
        assertEquals(0, result.settles)
    }

    @Test
    fun invokeResolvesThroughBindingAndReleasesTemporaryLease() {
        val capability = FakeCapability("alpha", methods = setOf("ping"))
        val registry = NativeCapabilityRegistry(listOf(capability))
        val result = RecordingResult()

        registry.invoke("alpha", "ping", mapOf("value" to 7), result)

        assertEquals(1, result.settles)
        assertEquals(mapOf("method" to "ping"), result.value)
        assertEquals(mapOf("value" to 7), capability.activeBinding.calls.single().payload)
        assertEquals(1, capability.activeBinding.releases)
        assertEquals(0, registry.activeReferences("alpha"))
    }

    @Test
    fun delayedCapabilitySettlesOnceAndStillReleasesTheLease() {
        val binding = RecordingBinding(autoResolve = false)
        val capability = FakeCapability("alpha", binding = binding)
        val registry = NativeCapabilityRegistry(listOf(capability))
        val result = RecordingResult()

        registry.invoke("alpha", "ping", emptyMap(), result)
        assertEquals(1, registry.activeReferences("alpha"))

        binding.pending!!.resolve("first")
        binding.pending!!.resolve("second")
        binding.pending!!.reject("late")

        assertEquals(1, result.settles)
        assertEquals("first", result.value)
        assertNull(result.failure)
        assertEquals(1, binding.releases)
        assertEquals(0, registry.activeReferences("alpha"))
    }

    @Test
    fun bindingFailureRejectsAndReleasesTheTemporaryLease() {
        val binding = RecordingBinding(throwOnInvoke = true)
        val capability = FakeCapability("alpha", binding = binding)
        val registry = NativeCapabilityRegistry(listOf(capability))
        val result = RecordingResult()

        registry.invoke("alpha", "ping", emptyMap(), result)

        assertEquals(1, result.settles)
        assertTrue(result.failure!!.startsWith("Native capability invocation failed: boom"))
        assertEquals(1, binding.releases)
        assertEquals(0, registry.activeReferences("alpha"))
    }

    @Test
    fun dottedCapabilityIdsAreAccepted() {
        val registry = NativeCapabilityRegistry(listOf(FakeCapability("native.files")))
        assertEquals("native.files@1", registry.describe().single().qualifiedId)
        assertEquals(1, registry.acquire("native.files@1").version)
    }

    @Test
    fun descriptorsCopyDeclaredConfiguration() {
        val capability = FakeCapability(
            "alpha",
            config = mapOf("enabled" to true, "region" to "test"),
        )
        val descriptor = NativeCapabilityRegistry(listOf(capability)).describe().single()
        assertEquals(mapOf("enabled" to true, "region" to "test"), descriptor.config)
    }

    @Test
    fun disposeReleasesEveryOutstandingLeaseAndDependencyOnce() {
        val dependency = FakeCapability("alpha")
        val dependent = FakeCapability("beta", dependencies = listOf("alpha"))
        val registry = NativeCapabilityRegistry(listOf(dependency, dependent))
        registry.acquire("beta")
        registry.acquire("alpha")

        registry.dispose()

        assertEquals(1, dependent.activeBinding.releases)
        assertEquals(1, dependency.activeBinding.releases)
        assertEquals(0, registry.activeReferences("alpha"))
        assertEquals(0, registry.activeReferences("beta"))
        registry.dispose()
    }
}
