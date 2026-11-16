package me.uwen.orahako.widget.exam

import me.uwen.orahako.nativebridge.NativeCapabilityFactory
import me.uwen.orahako.widget.AndroidWidgetsController
import me.uwen.orahako.widget.NativeWidgetCompositionModule
import me.uwen.orahako.widget.NativeWidgetDeclaration

/**
 * Exam widget composition contribution. Selecting this module enables the
 * `widgets.exam` capability and declares the exam widgets; the generic widget
 * host stays independent of the official companions.
 */
object ExamWidgetComposition : NativeWidgetCompositionModule {

    override val declaredWidgets: List<NativeWidgetDeclaration> =
        ExamWidgetCompanion.declarations

    override val factories: Map<String, NativeCapabilityFactory> = mapOf(
        ExamWidgetsCapability.ID to { host, config ->
            ExamWidgetsCapability(
                config,
                AndroidWidgetsController(host.context, ExamWidgetCompanion.declarations),
            )
        },
    )
}
