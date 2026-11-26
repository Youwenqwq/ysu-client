package me.uwen.orahako.widget.exam

import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.widget.WidgetsController
import me.uwen.orahako.widget.requireObject

/**
 * Exam widget companion capability. It owns the exam/exam-compact widget
 * declarations and consumes one declarative exam snapshot.
 */
class ExamWidgetsCapability(
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
                result.reject(error.message ?: "Exam widget invocation failed", error)
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
                controller.update(ExamWidgetCompanion.WIDGET_IDS, snapshot, settings)
            }

            "settings" -> {
                val settings = payload.requireObject("settings")
                    ?: throw IllegalArgumentException("Missing 'settings'")
                controller.updateSettings(ExamWidgetCompanion.WIDGET_IDS, settings)
            }

            "clear" -> controller.clear(ExamWidgetCompanion.WIDGET_IDS)
        }
    }

    companion object {
        const val ID = "widgets.exam"
    }
}
