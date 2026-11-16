package me.uwen.orahako.widget.exam

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

class ExamWidget2x2Provider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        ExamWidgetCompanion.render(
            context,
            ExamWidgetCompanion.COMPACT_WIDGET_ID,
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
        ExamWidgetCompanion.render(
            context,
            ExamWidgetCompanion.COMPACT_WIDGET_ID,
            appWidgetManager,
            intArrayOf(appWidgetId),
        )
    }
}
