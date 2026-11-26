package me.uwen.orahako.nativebridge.capabilities.geolocation

/**
 * Decoded platform position mapped onto the browser `GeolocationCoordinates`
 * surface. Values Android cannot report stay null instead of being fabricated.
 */
internal data class LocationFix(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Double,
    val altitudeMeters: Double? = null,
    val altitudeAccuracyMeters: Double? = null,
    val headingDegrees: Double? = null,
    val speedMetersPerSecond: Double? = null,
    val timestampMillis: Long = System.currentTimeMillis(),
)

/** One in-flight request; [cancel] settles it without delivering a result. */
internal interface LocationRequest {
    fun cancel()
}

/**
 * Platform seam around Android location services.
 *
 * Implementations must deliver the callback of
 * [requestCurrentPosition] exactly once and never before returning the request.
 */
internal interface LocationSource {
    /** Enabled providers in preference order for the requested accuracy mode. */
    fun enabledProviders(highAccuracy: Boolean): List<String>

    /** Newest cached fix no older than [maximumAgeMillis], when one exists. */
    fun lastKnownPosition(providers: List<String>, maximumAgeMillis: Long): LocationFix?

    fun requestCurrentPosition(
        providers: List<String>,
        timeoutMillis: Long,
        onResult: (LocationFix?) -> Unit,
    ): LocationRequest
}

/** Browser `GeolocationPosition` JSON shape returned to plugin callers. */
internal fun LocationFix.toPositionJson(): Map<String, Any?> = mapOf(
    "coords" to mapOf(
        "latitude" to latitude,
        "longitude" to longitude,
        "accuracy" to accuracyMeters,
        "altitude" to altitudeMeters,
        "altitudeAccuracy" to altitudeAccuracyMeters,
        "heading" to headingDegrees,
        "speed" to speedMetersPerSecond,
    ),
    "timestamp" to timestampMillis,
)
