package me.uwen.orahako.widget

import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeCapabilityReconciler
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.nativebridge.kotlinValueToJson
import org.json.JSONObject

/**
 * Generic widget surface: declaration listing, pinning, declarative snapshot
 * updates, settings, clearing and reconciliation.
 *
 * The capability knows widget ids only as open strings supplied by the enabled
 * companion capabilities; it never switches on official schedule/exam ids.
 */
class WidgetsCapability(
    override val config: Map<String, Any?>,
    private val controller: WidgetsController,
) : NativeCapability, NativeCapabilityReconciler {

    override val id: String = ID
    override val version: Int = 1
    override val methods: Set<String> = setOf(
        "clear",
        "list",
        "pin",
        "reconcile",
        "settings",
        "update",
    )

    override fun bind(): NativeCapabilityBinding = Binding()

    private inner class Binding : NativeCapabilityBinding {
        override fun invoke(
            method: String,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            try {
                handle(method, payload, result)
            } catch (error: Exception) {
                result.reject(
                    error.message ?: "Native widget invocation failed",
                    error,
                )
            }
        }

        override fun release() {
            controller.release()
        }
    }

    private fun handle(
        method: String,
        payload: Map<String, Any?>,
        result: NativeInvokeResult,
    ) {
        when (method) {
            "list" -> result.resolve(
                mapOf(
                    "widgets" to controller.declarations().map { declaration ->
                        mapOf(
                            "id" to declaration.id,
                            "provider" to declaration.providerClass.name,
                            "capability" to declaration.capabilityId,
                        )
                    }
                )
            )

            "pin" -> {
                val widgetId = payload.requireWidgetId(required = true)!!
                controller.requestPin(widgetId) { added ->
                    result.resolve(mapOf("added" to added))
                }
            }

            "update" -> {
                val widgetId = payload.requireWidgetId(required = true)!!
                val snapshot = payload.requireObject("snapshot")
                    ?: throw IllegalArgumentException("Missing 'snapshot'")
                val settings = payload.requireObject("settings")
                controller.update(listOf(widgetId), snapshot, settings)
                result.resolve(null)
            }

            "settings" -> {
                val settings = payload.requireObject("settings")
                    ?: throw IllegalArgumentException("Missing 'settings'")
                val widgetId = payload.requireWidgetId(required = false)
                val targets = widgetId?.let(::listOf)
                    ?: controller.declarations().map { it.id }
                controller.updateSettings(targets, settings)
                result.resolve(null)
            }

            "clear" -> {
                val widgetId = payload.requireWidgetId(required = false)
                controller.clear(widgetId?.let(::listOf))
                result.resolve(null)
            }

            "reconcile" -> {
                controller.reconcile()
                result.resolve(null)
            }
        }
    }

    override fun reconcile() {
        controller.reconcile()
    }

    companion object {
        const val ID = "widgets.generic"
    }
}

fun Map<String, Any?>.requireWidgetId(required: Boolean): String? {
    val value = this["widget"]
    if (value == null) {
        if (required) throw IllegalArgumentException("Missing 'widget'")
        return null
    }
    val widgetId = value as? String
        ?: throw IllegalArgumentException("'widget' must be a string")
    if (widgetId.isBlank()) throw IllegalArgumentException("'widget' must not be blank")
    return widgetId
}

fun Map<String, Any?>.requireObject(key: String): JSONObject? {
    val value = this[key] ?: return null
    val map = value as? Map<*, *>
        ?: throw IllegalArgumentException("'$key' must be an object")
    return kotlinValueToJson(map) as JSONObject
}
