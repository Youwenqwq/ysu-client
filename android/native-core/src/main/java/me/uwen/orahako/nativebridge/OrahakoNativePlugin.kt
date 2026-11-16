package me.uwen.orahako.nativebridge

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The single Capacitor entry point for native capabilities.
 *
 * JavaScript only sees the generic `describe` / `acquire` / `release` /
 * `invoke` surface. Which capabilities exist is decided at build time by
 * `assets/native-companion.json` and the [NativeCapabilityFactories] installed
 * by the host application's composition.
 */
@CapacitorPlugin(name = "OrahakoNative")
class OrahakoNativePlugin : Plugin() {

    private val host = PluginCapabilityHost()
    private var registry: NativeCapabilityRegistry? = null
    private var compositionError: NativeCapabilityCompositionException? = null

    override fun load() {
        try {
            val config = NativeCompanionConfig.load(context)
            registry = NativeCapabilityRegistry(
                NativeComposition.require().create(host, config.entries)
            )
        } catch (error: NativeCapabilityCompositionException) {
            compositionError = error
        } catch (error: Exception) {
            compositionError = NativeCapabilityCompositionException(
                "Invalid ${NativeCompanionConfig.ASSET_NAME}: " +
                    (error.message ?: error.javaClass.simpleName),
                error,
            )
        }
    }

    override fun handleOnDestroy() {
        registry?.dispose()
        registry = null
    }

    @PluginMethod
    fun describe(call: PluginCall) {
        val registry = registryOrReject(call) ?: return
        try {
            val capabilities = JSArray()
            for (descriptor in registry.describe()) {
                capabilities.put(
                    JSObject()
                        .put("id", descriptor.id)
                        .put("version", descriptor.version)
                        .put("methods", JSArray(descriptor.methods))
                        .put("dependencies", JSArray(descriptor.dependencies))
                        .put("config", kotlinValueToJson(descriptor.config))
                )
            }
            call.resolve(JSObject().put("capabilities", capabilities))
        } catch (error: Exception) {
            rejectCapabilityError(call, error)
        }
    }

    @PluginMethod
    fun acquire(call: PluginCall) {
        val registry = registryOrReject(call) ?: return
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("Missing capability id", "INVALID_ARGUMENT")
            return
        }
        try {
            val lease = registry.acquire(id)
            call.resolve(
                JSObject()
                    .put("token", lease.token.toString())
                    .put("id", lease.capabilityId)
                    .put("version", lease.version)
                    .put("dependencies", JSArray(lease.dependencies))
            )
        } catch (error: Exception) {
            rejectCapabilityError(call, error)
        }
    }

    @PluginMethod
    fun release(call: PluginCall) {
        val registry = registryOrReject(call) ?: return
        val token = call.getString("token")?.toLongOrNull()
        if (token == null) {
            call.reject("Missing or invalid lease token", "INVALID_ARGUMENT")
            return
        }
        try {
            call.resolve(JSObject().put("released", registry.release(token)))
        } catch (error: Exception) {
            rejectCapabilityError(call, error)
        }
    }

    @PluginMethod
    fun invoke(call: PluginCall) {
        val registry = registryOrReject(call) ?: return
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("Missing capability id", "INVALID_ARGUMENT")
            return
        }
        val method = call.getString("method")
        if (method.isNullOrBlank()) {
            call.reject("Missing capability method", "INVALID_ARGUMENT")
            return
        }
        val payload = call.getObject("payload")
            ?.let { jsonValueToKotlin(it) as Map<String, Any?> }
            ?: emptyMap()

        try {
            registry.invoke(id, method, payload, object : NativeInvokeResult {
                override fun resolve(value: Any?) = resolveCapabilityValue(call, value)

                override fun reject(message: String, cause: Throwable?) {
                    call.reject(message, "CAPABILITY_ERROR", cause as? Exception)
                }
            })
        } catch (error: Exception) {
            rejectCapabilityError(call, error)
        }
    }

    private fun registryOrReject(call: PluginCall): NativeCapabilityRegistry? {
        registry?.let { return it }
        val error = compositionError
            ?: NativeCapabilityCompositionException("Native capability registry is not initialized")
        rejectCapabilityError(call, error)
        return null
    }

    private fun resolveCapabilityValue(call: PluginCall, value: Any?) {
        when (value) {
            null -> call.resolve()
            is Map<*, *> -> call.resolve(
                JSObject().apply {
                    value.forEach { (key, item) ->
                        put(key.toString(), kotlinValueToJson(item))
                    }
                }
            )
            else -> call.resolve(JSObject().put("value", kotlinValueToJson(value)))
        }
    }

    private fun rejectCapabilityError(call: PluginCall, error: Throwable) {
        val code = when (error) {
            is UnknownNativeCapabilityException -> "UNKNOWN_CAPABILITY"
            is UnknownNativeCapabilityMethodException -> "UNKNOWN_METHOD"
            is NativeCapabilityCompositionException -> "COMPOSITION_ERROR"
            else -> "CAPABILITY_ERROR"
        }
        call.reject(
            error.message ?: error.javaClass.simpleName,
            code,
            error as? Exception,
        )
    }

    private inner class PluginCapabilityHost : NativeCapabilityHost {
        override val context: Context
            get() = this@OrahakoNativePlugin.context

        override val activity: Activity?
            get() = this@OrahakoNativePlugin.activity

        override fun hasPermission(permission: String): Boolean =
            ContextCompat.checkSelfPermission(context, permission) ==
                PackageManager.PERMISSION_GRANTED

        override fun requestPermissions(
            permissions: Array<String>,
            onResult: (Boolean) -> Unit,
        ) = NativeRuntimePermissions.request(activity, permissions, onResult)

        override fun runOnUiThread(action: () -> Unit) {
            activity?.runOnUiThread(action)
        }

        override fun evaluateJavascript(script: String) {
            bridge.webView.evaluateJavascript(script, null)
        }

        override fun emit(capabilityId: String, event: String, data: Map<String, Any?>) {
            notifyListeners(
                CAPABILITY_EVENT,
                JSObject()
                    .put("capabilityId", capabilityId)
                    .put("event", event)
                    .put("data", kotlinValueToJson(data)),
            )
        }
    }

    companion object {
        private const val CAPABILITY_EVENT = "capabilityEvent"
    }
}
