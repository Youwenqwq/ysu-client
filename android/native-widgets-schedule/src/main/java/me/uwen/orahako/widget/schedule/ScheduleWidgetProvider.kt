package me.uwen.orahako.widget.schedule

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

class ScheduleWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        ScheduleWidgetCompanion.render(
            context,
            ScheduleWidgetCompanion.SCHEDULE_WIDGET_ID,
            appWidgetManager,
            appWidgetIds,
        )
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle?,
    ) {
        ScheduleWidgetCompanion.render(
            context,
            ScheduleWidgetCompanion.SCHEDULE_WIDGET_ID,
            appWidgetManager,
            intArrayOf(appWidgetId),
        )
    }
}
