package me.uwen.orahako.widget.schedule

import android.appwidget.AppWidgetManager
import android.content.Context
import me.uwen.orahako.widget.NativeWidgetDeclaration
import me.uwen.orahako.widget.SharedPreferencesNativeWidgetStore
import me.uwen.orahako.widget.UnknownNativeWidgetException

/**
 * Schedule widget declarations. The companion owns the schedule/tomorrow ids
 * and the rendering; the generic widget host only dispatches by string id.
 */
object ScheduleWidgetCompanion {
    const val CAPABILITY_ID = "widgets.schedule"
    const val SCHEDULE_WIDGET_ID = "schedule"
    const val TOMORROW_WIDGET_ID = "tomorrow"

    val WIDGET_IDS: List<String> = listOf(SCHEDULE_WIDGET_ID, TOMORROW_WIDGET_ID)

    val declarations: List<NativeWidgetDeclaration> = listOf(
        NativeWidgetDeclaration(
            id = SCHEDULE_WIDGET_ID,
            providerClass = ScheduleWidgetProvider::class.java,
            renderer = ScheduleWidgetRenderer(showTomorrow = false),
            capabilityId = CAPABILITY_ID,
        ),
        NativeWidgetDeclaration(
            id = TOMORROW_WIDGET_ID,
            providerClass = TomorrowScheduleWidgetProvider::class.java,
            renderer = ScheduleWidgetRenderer(showTomorrow = true),
            capabilityId = CAPABILITY_ID,
        ),
    )

    private val declarationsById: Map<String, NativeWidgetDeclaration> =
        declarations.associateBy { it.id }

    fun render(
        context: Context,
        widgetId: String,
        manager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        val declaration = declarationsById[widgetId]
            ?: throw UnknownNativeWidgetException(widgetId)
        if (appWidgetIds.isEmpty()) return
        val state = SharedPreferencesNativeWidgetStore(context).readState(widgetId)
        for (appWidgetId in appWidgetIds) {
            declaration.renderer.render(context, appWidgetId, manager, state)
        }
    }
}
