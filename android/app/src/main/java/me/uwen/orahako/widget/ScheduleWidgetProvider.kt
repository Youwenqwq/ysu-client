package me.uwen.orahako.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

class ScheduleWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val helper = ScheduleWidgetHelper(context)
        for (appWidgetId in appWidgetIds) {
            helper.updateWidget(appWidgetId, appWidgetManager)
        }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle?
    ) {
        val helper = ScheduleWidgetHelper(context)
        helper.updateWidget(appWidgetId, appWidgetManager)
    }
}
