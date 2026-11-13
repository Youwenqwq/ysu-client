package me.uwen.orahako.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

class ExamWidget2x2Provider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val helper = ExamWidgetHelper(context)
        for (appWidgetId in appWidgetIds) {
            helper.update2x2Widget(appWidgetId, appWidgetManager)
        }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle?
    ) {
        val helper = ExamWidgetHelper(context)
        helper.update2x2Widget(appWidgetId, appWidgetManager)
    }
}
