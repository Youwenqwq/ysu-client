package me.uwen.orahako.widget.schedule

import me.uwen.orahako.nativebridge.NativeCapabilityFactory
import me.uwen.orahako.widget.AndroidWidgetsController
import me.uwen.orahako.widget.NativeWidgetCompositionModule
import me.uwen.orahako.widget.NativeWidgetDeclaration

/**
 * Schedule widget composition contribution. Selecting this module enables the
 * `widgets.schedule` capability and declares the schedule/tomorrow widgets; the
 * generic widget host stays independent of the official companions.
 */
object ScheduleWidgetComposition : NativeWidgetCompositionModule {

    override val declaredWidgets: List<NativeWidgetDeclaration> =
        ScheduleWidgetCompanion.declarations

    override val factories: Map<String, NativeCapabilityFactory> = mapOf(
        ScheduleWidgetsCapability.ID to { host, config ->
            ScheduleWidgetsCapability(
                config,
                AndroidWidgetsController(host.context, ScheduleWidgetCompanion.declarations),
            )
        },
    )
}
