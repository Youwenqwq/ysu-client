package me.uwen.orahako.widget.schedule

import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.widget.WidgetsController
import me.uwen.orahako.widget.requireObject

/**
 * Schedule widget companion capability. It owns the schedule/tomorrow widget
 * declarations and translates the declarative schedule snapshot into the
 * generic widget store. The generic host never names these widget ids.
 */
class ScheduleWidgetsCapability(
    override val config: Map<String, Any?>,
    private val controller: WidgetsController,
) : NativeCapability {

    override val id: String = ID
    override val version: Int = 1
    override val methods: Set<String> = setOf("clear", "settings", "sync")

    override fun bind(): NativeCapabilityBinding = Binding()

    private inner class Binding : NativeCapabilityBinding {
        override fun invoke(
            method: String,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            try {
                handle(method, payload)
                result.resolve(null)
            } catch (error: Exception) {
                result.reject(error.message ?: "Schedule widget invocation failed", error)
            }
        }

        override fun release() = Unit
    }

    private fun handle(method: String, payload: Map<String, Any?>) {
        when (method) {
            "sync" -> {
                val snapshot = payload.requireObject("snapshot")
                    ?: throw IllegalArgumentException("Missing 'snapshot'")
                val settings = payload.requireObject("settings")
                controller.update(ScheduleWidgetCompanion.WIDGET_IDS, snapshot, settings)
            }

            "settings" -> {
                val settings = payload.requireObject("settings")
                    ?: throw IllegalArgumentException("Missing 'settings'")
                controller.updateSettings(ScheduleWidgetCompanion.WIDGET_IDS, settings)
            }

            "clear" -> controller.clear(ScheduleWidgetCompanion.WIDGET_IDS)
        }
    }

    companion object {
        const val ID = "widgets.schedule"
    }
}
