package me.uwen.orahako.nativebridge.capabilities.geolocation

import android.Manifest
import android.app.Activity
import android.content.Context
import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeCapabilityRegistry
import me.uwen.orahako.nativebridge.NativeInvokeResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GeolocationCapabilityTest {

    private class FakeHost(
        private val granted: Set<String>,
        private val onRequestPermissions: (Array<String>, (Boolean) -> Unit) -> Unit =
            { _, onResult -> onResult(false) },
    ) : NativeCapabilityHost {
        override val context: Context
            get() = error("the injected location source must not read the Android context")
        override val activity: Activity?
            get() = null

        override fun hasPermission(permission: String): Boolean = permission in granted

        override fun requestPermissions(permissions: Array<String>, onResult: (Boolean) -> Unit) =
            onRequestPermissions(permissions, onResult)

        override fun runOnUiThread(action: () -> Unit) = action()

        override fun evaluateJavascript(script: String) = Unit

        override fun emit(capabilityId: String, event: String, data: Map<String, Any?>) = Unit
    }

    private class FakeLocationSource(
        private val providers: List<String> = listOf("gps"),
        private val cached: LocationFix? = null,
    ) : LocationSource {
        var requestedHighAccuracy: Boolean? = null
        var requestedProviders: List<String>? = null
        var requestedTimeoutMillis: Long? = null
        var requestedMaximumAgeMillis: Long? = null
        var cancels = 0

        private var deliverResult: ((LocationFix?) -> Unit)? = null

        override fun enabledProviders(highAccuracy: Boolean): List<String> {
            requestedHighAccuracy = highAccuracy
            return providers
        }

        override fun lastKnownPosition(
            providers: List<String>,
            maximumAgeMillis: Long,
        ): LocationFix? {
            requestedMaximumAgeMillis = maximumAgeMillis
            return cached
        }

        override fun requestCurrentPosition(
            providers: List<String>,
            timeoutMillis: Long,
            onResult: (LocationFix?) -> Unit,
        ): LocationRequest {
            requestedProviders = providers
            requestedTimeoutMillis = timeoutMillis
            deliverResult = onResult
            return object : LocationRequest {
                override fun cancel() {
                    cancels += 1
                }
            }
        }

        fun deliver(fix: LocationFix?) {
            deliverResult?.invoke(fix)
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

    private fun capability(
        host: NativeCapabilityHost,
        source: FakeLocationSource,
        config: Map<String, Any?> = emptyMap(),
    ): NativeCapability = GeolocationCapability(host, config) { source }

    private fun invoke(
        capability: NativeCapability,
        payload: Map<String, Any?> = emptyMap(),
    ): RecordingResult {
        val registry = NativeCapabilityRegistry(listOf(capability))
        val result = RecordingResult()
        registry.invoke(
            GeolocationCapability.ID,
            GeolocationCapability.METHOD_GET_CURRENT_POSITION,
            payload,
            result,
        )
        return result
    }

    private fun fix(): LocationFix = LocationFix(
        latitude = 39.9352,
        longitude = 119.6001,
        accuracyMeters = 12.5,
        altitudeMeters = 18.25,
        altitudeAccuracyMeters = 3.5,
        headingDegrees = 91.0,
        speedMetersPerSecond = 1.25,
        timestampMillis = 1_700_000_000_000L,
    )

    @Test
    fun registryDescribesOnlyTheBrowserCompatibleMethod() {
        val registry = NativeCapabilityRegistry(
            listOf(capability(FakeHost(emptySet()), FakeLocationSource()))
        )

        val descriptor = registry.describe().single()
        assertEquals("native.geolocation", descriptor.id)
        assertEquals(1, descriptor.version)
        assertEquals(listOf("getCurrentPosition"), descriptor.methods)
        assertEquals(emptyList<String>(), descriptor.dependencies)
    }

    @Test
    fun grantedPermissionResolvesBrowserCompatiblePosition() {
        val source = FakeLocationSource()
        val host = FakeHost(setOf(Manifest.permission.ACCESS_FINE_LOCATION))
        val result = invoke(capability(host, source))

        assertEquals(0, result.settles)

        source.deliver(fix())

        assertEquals(1, result.settles)
        val position = result.value as Map<*, *>
        val coords = position["coords"] as Map<*, *>
        assertEquals(39.9352, coords["latitude"] as Double, 0.0)
        assertEquals(119.6001, coords["longitude"] as Double, 0.0)
        assertEquals(12.5, coords["accuracy"] as Double, 0.0)
        assertEquals(18.25, coords["altitude"] as Double, 0.0)
        assertEquals(3.5, coords["altitudeAccuracy"] as Double, 0.0)
        assertEquals(91.0, coords["heading"] as Double, 0.0)
        assertEquals(1.25, coords["speed"] as Double, 0.0)
        assertEquals(1_700_000_000_000L, position["timestamp"])
        assertEquals(listOf("gps"), source.requestedProviders)
        assertEquals(15_000L, source.requestedTimeoutMillis)
    }

    @Test
    fun unknownOptionalCoordinatesStayNull() {
        val source = FakeLocationSource()
        val result = invoke(capability(FakeHost(setOf(Manifest.permission.ACCESS_COARSE_LOCATION)), source))

        source.deliver(LocationFix(latitude = 1.0, longitude = 2.0, accuracyMeters = 0.0, timestampMillis = 42L))

        val position = result.value as Map<*, *>
        val coords = position["coords"] as Map<*, *>
        assertEquals(1.0, coords["latitude"] as Double, 0.0)
        assertEquals(0.0, coords["accuracy"] as Double, 0.0)
        assertNull(coords["altitude"])
        assertNull(coords["altitudeAccuracy"])
        assertNull(coords["heading"])
        assertNull(coords["speed"])
        assertEquals(42L, position["timestamp"])
    }

    @Test
    fun coarsePermissionIsEnoughAndSkipsThePrompt() {
        val source = FakeLocationSource()
        val host = FakeHost(setOf(Manifest.permission.ACCESS_COARSE_LOCATION)) { _, _ ->
            error("a granted coarse permission must not prompt")
        }

        val result = invoke(capability(host, source))
        source.deliver(fix())

        assertEquals(setOf("gps"), source.requestedProviders?.toSet())
        assertEquals(1, result.settles)
        assertTrue(result.value is Map<*, *>)
    }

    @Test
    fun permissionDenialRejectsWithoutReadingLocationServices() {
        var requestedPermissions: List<String>? = null
        val host = FakeHost(emptySet()) { permissions, onResult ->
            requestedPermissions = permissions.toList()
            onResult(false)
        }
        val source = FakeLocationSource()

        val result = invoke(capability(host, source))

        assertEquals(
            listOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ),
            requestedPermissions,
        )
        assertEquals("Location permission denied", result.failure)
        assertEquals(1, result.settles)
        assertNull(source.requestedProviders)
    }

    @Test
    fun grantedPromptContinuesToAPositionRequest() {
        var requestedPermissions: List<String>? = null
        val host = FakeHost(emptySet()) { permissions, onResult ->
            requestedPermissions = permissions.toList()
            onResult(true)
        }
        val source = FakeLocationSource()

        val result = invoke(capability(host, source))

        assertEquals(
            listOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ),
            requestedPermissions,
        )
        assertEquals(0, result.settles)
        assertEquals(listOf("gps"), source.requestedProviders)

        source.deliver(fix())
        assertEquals(1, result.settles)
        assertTrue(result.value is Map<*, *>)
    }

    @Test
    fun disabledLocationServicesRejectDeterministically() {
        val source = FakeLocationSource(providers = emptyList())
        val host = FakeHost(setOf(Manifest.permission.ACCESS_FINE_LOCATION))

        val result = invoke(capability(host, source))

        assertEquals(
            "Location unavailable: no location provider is enabled",
            result.failure,
        )
        assertEquals(1, result.settles)
        assertNull(source.requestedProviders)
    }

    @Test
    fun missingFixWithinTheTimeoutRejectsDeterministically() {
        val source = FakeLocationSource()
        val host = FakeHost(setOf(Manifest.permission.ACCESS_FINE_LOCATION))

        val result = invoke(capability(host, source, mapOf("timeoutMillis" to 4321)))
        assertEquals(4321L, source.requestedTimeoutMillis)

        source.deliver(null)

        assertEquals("Location unavailable: no position fix within 4321 ms", result.failure)
        assertEquals(1, result.settles)
    }

    @Test
    fun freshCachedFixResolvesWithoutRequestingUpdates() {
        val cached = fix()
        val source = FakeLocationSource(cached = cached)
        val host = FakeHost(setOf(Manifest.permission.ACCESS_FINE_LOCATION))

        val result = invoke(
            capability(host, source, mapOf("maximumAgeMillis" to 60_000)),
        )

        assertEquals(1, result.settles)
        assertEquals(60_000L, source.requestedMaximumAgeMillis)
        assertNull(source.requestedProviders)
        assertEquals(cached.timestampMillis, (result.value as Map<*, *>)["timestamp"])
    }

    @Test
    fun payloadOptionsOverrideCompositionDefaults() {
        val source = FakeLocationSource()
        val host = FakeHost(setOf(Manifest.permission.ACCESS_FINE_LOCATION))

        val result = invoke(
            capability(host, source, mapOf("timeoutMillis" to 15_000)),
            mapOf(
                "timeout" to 5_000.0,
                "maximumAge" to 0.0,
                "enableHighAccuracy" to true,
            ),
        )

        assertEquals(5_000L, source.requestedTimeoutMillis)
        assertEquals(true, source.requestedHighAccuracy)
        assertEquals(0, result.settles)

        source.deliver(fix())
        assertEquals(1, result.settles)
    }

    @Test
    fun releasingTheCapabilityCancelsAnInFlightRequest() {
        val source = FakeLocationSource()
        val host = FakeHost(setOf(Manifest.permission.ACCESS_FINE_LOCATION))
        val registry = NativeCapabilityRegistry(listOf(capability(host, source)))
        val result = RecordingResult()

        registry.invoke(
            GeolocationCapability.ID,
            GeolocationCapability.METHOD_GET_CURRENT_POSITION,
            emptyMap(),
            result,
        )
        assertEquals(1, registry.activeReferences(GeolocationCapability.ID))

        registry.dispose()

        assertEquals(1, source.cancels)
        assertEquals(0, registry.activeReferences(GeolocationCapability.ID))
        assertEquals(0, result.settles)
    }
}
