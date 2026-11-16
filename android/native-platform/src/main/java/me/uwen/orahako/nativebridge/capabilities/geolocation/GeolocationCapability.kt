package me.uwen.orahako.nativebridge.capabilities.geolocation

import android.Manifest
import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeInvokeResult
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Browser-compatible current-position lookup backed by Android location
 * services.
 *
 * JavaScript only sees `getCurrentPosition`. Permission prompting, provider
 * selection, the timeout and the `GeolocationPosition` JSON shape are owned
 * here; composition supplies the auditable defaults.
 */
class GeolocationCapability internal constructor(
    private val host: NativeCapabilityHost,
    override val config: Map<String, Any?>,
    private val locationSourceFactory: () -> LocationSource,
) : NativeCapability {

    constructor(host: NativeCapabilityHost, config: Map<String, Any?>) : this(
        host,
        config,
        { AndroidLocationSource(host.context) },
    )

    override val id: String = ID
    override val version: Int = VERSION
    override val methods: Set<String> = setOf(METHOD_GET_CURRENT_POSITION)

    private val defaultTimeoutMillis: Long = (config["timeoutMillis"] as? Number)
        ?.toLong()
        ?.coerceIn(MIN_TIMEOUT_MILLIS, MAX_TIMEOUT_MILLIS)
        ?: DEFAULT_TIMEOUT_MILLIS

    private val defaultMaximumAgeMillis: Long = (config["maximumAgeMillis"] as? Number)
        ?.toLong()
        ?.coerceIn(0L, MAX_MAXIMUM_AGE_MILLIS)
        ?: DEFAULT_MAXIMUM_AGE_MILLIS

    override fun bind(): NativeCapabilityBinding = Binding(locationSourceFactory())

    private inner class Binding(
        private val source: LocationSource,
    ) : NativeCapabilityBinding {

        private val pending = LinkedHashSet<LocationRequest>()
        private var released = false

        override fun invoke(
            method: String,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            when (method) {
                METHOD_GET_CURRENT_POSITION -> getCurrentPosition(source, payload, result)
            }
        }

        override fun release() {
            val requests = synchronized(pending) {
                released = true
                pending.toList().also { pending.clear() }
            }
            for (request in requests) request.cancel()
        }

        private fun getCurrentPosition(
            source: LocationSource,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            if (hasLocationPermission()) {
                requestPosition(source, payload, result)
                return
            }
            try {
                host.requestPermissions(LOCATION_PERMISSIONS) { granted ->
                    if (granted || hasLocationPermission()) {
                        requestPosition(source, payload, result)
                    } else {
                        result.reject("Location permission denied")
                    }
                }
            } catch (error: Exception) {
                result.reject(
                    "Location permission unavailable: " +
                        (error.message ?: error.javaClass.simpleName),
                    error,
                )
            }
        }

        private fun requestPosition(
            source: LocationSource,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            val options = positionOptions(payload)
            val providers = source.enabledProviders(options.highAccuracy)
            if (providers.isEmpty()) {
                result.reject("Location unavailable: no location provider is enabled")
                return
            }
            if (options.maximumAgeMillis > 0) {
                val cached = source.lastKnownPosition(providers, options.maximumAgeMillis)
                if (cached != null) {
                    result.resolve(cached.toPositionJson())
                    return
                }
            }

            val settled = AtomicBoolean(false)
            var request: LocationRequest? = null

            fun deliver(fix: LocationFix?) {
                if (!settled.compareAndSet(false, true)) return
                request?.let { handle ->
                    synchronized(pending) { pending.remove(handle) }
                }
                if (fix != null) {
                    result.resolve(fix.toPositionJson())
                } else {
                    result.reject(
                        "Location unavailable: no position fix within " +
                            "${options.timeoutMillis} ms"
                    )
                }
            }

            request = source.requestCurrentPosition(
                providers,
                options.timeoutMillis,
                ::deliver,
            )
            val cancelImmediately = synchronized(pending) {
                when {
                    released -> true
                    settled.get() -> false
                    else -> {
                        pending.add(request)
                        false
                    }
                }
            }
            if (cancelImmediately) request.cancel()
        }

        private fun positionOptions(payload: Map<String, Any?>): PositionOptions {
            val timeout = (payload["timeout"] as? Number)
                ?.toLong()
                ?.takeIf { it > 0 }
                ?.coerceIn(MIN_TIMEOUT_MILLIS, MAX_TIMEOUT_MILLIS)
                ?: defaultTimeoutMillis
            val maximumAge = (payload["maximumAge"] as? Number)
                ?.toLong()
                ?.coerceIn(0L, MAX_MAXIMUM_AGE_MILLIS)
                ?: defaultMaximumAgeMillis
            return PositionOptions(
                timeoutMillis = timeout,
                maximumAgeMillis = maximumAge,
                highAccuracy = payload["enableHighAccuracy"] as? Boolean ?: false,
            )
        }
    }

    private fun hasLocationPermission(): Boolean =
        host.hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
            host.hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)

    companion object {
        const val ID = "native.geolocation"
        const val VERSION = 1
        const val METHOD_GET_CURRENT_POSITION = "getCurrentPosition"

        /** Runtime permissions owned by this capability; no core alias is involved. */
        val LOCATION_PERMISSIONS: Array<String> = arrayOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )

        private const val DEFAULT_TIMEOUT_MILLIS = 15_000L
        private const val DEFAULT_MAXIMUM_AGE_MILLIS = 0L
        private const val MIN_TIMEOUT_MILLIS = 1_000L
        private const val MAX_TIMEOUT_MILLIS = 120_000L
        private const val MAX_MAXIMUM_AGE_MILLIS = 86_400_000L
    }
}

private data class PositionOptions(
    val timeoutMillis: Long,
    val maximumAgeMillis: Long,
    val highAccuracy: Boolean,
)
