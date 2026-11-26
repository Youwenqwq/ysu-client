package me.uwen.orahako.nativebridge

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity

/**
 * Generic runtime-permission request flow.
 *
 * Nothing in the core names a concrete permission: each capability passes the
 * permissions it owns and keeps its own result semantics. The request is hosted
 * by a headless fragment, so a capability can ask for a new Android permission
 * without editing the bridge, the host activity or the composition.
 */
internal object NativeRuntimePermissions {

    private const val TAG_PREFIX = "orahako.native.permission"

    fun request(
        activity: Activity?,
        permissions: Array<String>,
        onResult: (Boolean) -> Unit,
    ) {
        if (permissions.isEmpty()) {
            onResult(false)
            return
        }
        val context = activity?.applicationContext
        if (context != null &&
            permissions.all {
                ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
            }
        ) {
            onResult(true)
            return
        }
        val fragmentActivity = activity as? FragmentActivity
            ?: throw NativeCapabilityCompositionException(
                "Runtime permissions require a FragmentActivity host"
            )
        fragmentActivity.runOnUiThread {
            try {
                val fragment = PermissionRequestFragment()
                fragmentActivity.supportFragmentManager
                    .beginTransaction()
                    .add(fragment, "$TAG_PREFIX.${System.nanoTime()}")
                    .commitNowAllowingStateLoss()
                fragment.request(permissions, onResult)
            } catch (error: Exception) {
                onResult(false)
            }
        }
    }
}

/** Headless fragment that owns one runtime-permission request and its result. */
internal class PermissionRequestFragment : Fragment() {

    private var callback: ((Boolean) -> Unit)? = null
    private var requested = false
    private var requestCode = 0

    @Suppress("DEPRECATION")
    fun request(permissions: Array<String>, callback: (Boolean) -> Unit) {
        this.callback = callback
        requested = true
        requestCode = nextRequestCode()
        requestPermissions(permissions, requestCode)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray,
    ) {
        if (!requested || requestCode != this.requestCode) return
        requested = false
        val granted = grantResults.isNotEmpty() &&
            grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        val settled = callback
        callback = null
        runCatching {
            parentFragmentManager.beginTransaction()
                .remove(this)
                .commitAllowingStateLoss()
        }
        settled?.invoke(granted)
    }

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        retainInstance = true
    }

    private companion object {
        private const val FIRST_REQUEST_CODE = 4701
        private var nextCode = FIRST_REQUEST_CODE

        @Synchronized
        fun nextRequestCode(): Int {
            val code = nextCode
            nextCode = if (nextCode >= 65535) FIRST_REQUEST_CODE else nextCode + 1
            return code
        }
    }
}
