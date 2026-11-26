package me.uwen.orahako.nativebridge

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat

/**
 * Platform services exposed to official capability factories. The generic
 * registry never sees this interface: only composition-built capabilities do.
 */
interface NativeCapabilityHost {
    val context: Context
    val activity: Activity?

    fun hasPermission(permission: String): Boolean

    /**
     * Requests arbitrary runtime permissions owned by a capability. The
     * callback reports whether every requested permission was granted and runs
     * on the main thread. No permission names live in the core.
     */
    fun requestPermissions(permissions: Array<String>, onResult: (Boolean) -> Unit)

    fun runOnUiThread(action: () -> Unit)

    fun evaluateJavascript(script: String)

    /** Emits a capability-scoped event to JavaScript listeners. */
    fun emit(capabilityId: String, event: String, data: Map<String, Any?>)
}

/**
 * Host used outside the mounted bridge (boot reconciliation, background
 * workers). It can read permissions and persist state but cannot prompt or
 * reach JavaScript; those operations are inert until the app is running.
 */
class ContextNativeCapabilityHost(override val context: Context) : NativeCapabilityHost {

    override val activity: Activity? = null

    override fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) ==
            PackageManager.PERMISSION_GRANTED

    override fun requestPermissions(permissions: Array<String>, onResult: (Boolean) -> Unit) =
        onResult(false)

    override fun runOnUiThread(action: () -> Unit) {
        Handler(Looper.getMainLooper()).post(action)
    }

    override fun evaluateJavascript(script: String) = Unit

    override fun emit(capabilityId: String, event: String, data: Map<String, Any?>) = Unit
}
