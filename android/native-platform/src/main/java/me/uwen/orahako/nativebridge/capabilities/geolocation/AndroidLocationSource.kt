package me.uwen.orahako.nativebridge.capabilities.geolocation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Android location access backed by [LocationManager].
 *
 * Google Play Services is deliberately not used: the Capacitor Geolocation
 * plugin's fused provider is bound to that plugin's lifecycle, while this
 * capability must resolve positions independently of the plugin instance.
 */
internal class AndroidLocationSource(private val context: Context) : LocationSource {

    private val locationManager: LocationManager? =
        context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager

    override fun enabledProviders(highAccuracy: Boolean): List<String> {
        val manager = locationManager ?: return emptyList()
        // The GPS provider demands a precise grant; with coarse-only access the
        // network provider still yields an approximate position.
        val candidates = buildList {
            if (highAccuracy && hasFinePermission()) add(LocationManager.GPS_PROVIDER)
            add(LocationManager.NETWORK_PROVIDER)
            if (hasFinePermission()) add(LocationManager.GPS_PROVIDER)
        }
        return candidates.distinct().filter { provider ->
            try {
                manager.isProviderEnabled(provider)
            } catch (_: Exception) {
                false
            }
        }
    }

    private fun hasFinePermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    override fun lastKnownPosition(
        providers: List<String>,
        maximumAgeMillis: Long,
    ): LocationFix? {
        val manager = locationManager ?: return null
        val now = System.currentTimeMillis()
        var newest: Location? = null
        for (provider in providers) {
            val location = try {
                manager.getLastKnownLocation(provider)
            } catch (_: Exception) {
                null
            } ?: continue
            val age = now - location.time
            if (age < 0 || age > maximumAgeMillis) continue
            if (newest == null || location.time > newest.time) newest = location
        }
        return newest?.let { it.toFix() }
    }

    override fun requestCurrentPosition(
        providers: List<String>,
        timeoutMillis: Long,
        onResult: (LocationFix?) -> Unit,
    ): LocationRequest =
        AndroidPositionRequest(context, locationManager, providers, timeoutMillis, onResult)
            .also { it.start() }
}

private class AndroidPositionRequest(
    private val context: Context,
    private val manager: LocationManager?,
    private val providers: List<String>,
    private val timeoutMillis: Long,
    private val onResult: (LocationFix?) -> Unit,
) : LocationRequest {

    private val handler = Handler(Looper.getMainLooper())
    private val settled = AtomicBoolean(false)
    private val listeners = ArrayList<LocationListener>()

    fun start() {
        val manager = manager
        if (manager != null) {
            for (provider in providers) {
                val listener = Listener()
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        manager.requestLocationUpdates(
                            provider,
                            0L,
                            0f,
                            ContextCompat.getMainExecutor(context),
                            listener,
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        manager.requestLocationUpdates(
                            provider,
                            0L,
                            0f,
                            listener,
                            Looper.getMainLooper(),
                        )
                    }
                    listeners.add(listener)
                } catch (_: Exception) {
                    // A provider that cannot be subscribed is dropped; remaining
                    // providers still race for the first fix.
                }
            }
        }
        if (listeners.isEmpty()) {
            handler.post { finish(null, deliver = true) }
            return
        }
        handler.postDelayed({ finish(null, deliver = true) }, timeoutMillis)
    }

    override fun cancel() {
        finish(null, deliver = false)
    }

    private fun finish(location: Location?, deliver: Boolean) {
        if (!settled.compareAndSet(false, true)) return
        handler.removeCallbacksAndMessages(null)
        val manager = manager
        if (manager != null) {
            for (listener in listeners) {
                try {
                    manager.removeUpdates(listener)
                } catch (_: Exception) {
                    // The provider may already be gone; nothing left to release.
                }
            }
        }
        listeners.clear()
        if (deliver) onResult(location?.let { it.toFix() })
    }

    private inner class Listener : LocationListener {
        override fun onLocationChanged(location: Location) {
            finish(location, deliver = true)
        }

        override fun onProviderDisabled(provider: String) = Unit

        override fun onProviderEnabled(provider: String) = Unit

        @Deprecated("Deprecated by the Android platform", ReplaceWith(""))
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }
}

/**
 * Maps an Android fix onto the browser coordinate surface. Availability flags
 * keep unknown values null; `accuracy` stays numeric because the browser
 * contract requires it.
 */
private fun Location.toFix(): LocationFix = LocationFix(
    latitude = latitude,
    longitude = longitude,
    accuracyMeters = if (hasAccuracy()) accuracy.toDouble() else 0.0,
    altitudeMeters = if (hasAltitude()) altitude else null,
    altitudeAccuracyMeters = if (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && hasVerticalAccuracy()
    ) {
        verticalAccuracyMeters.toDouble()
    } else {
        null
    },
    headingDegrees = if (hasBearing()) bearing.toDouble() else null,
    speedMetersPerSecond = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O -> if (hasSpeed()) speed.toDouble() else null
        speed > 0f -> speed.toDouble()
        else -> null
    },
    timestampMillis = if (time > 0L) time else System.currentTimeMillis(),
)
