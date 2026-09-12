package com.youwenqwq.ysuclient.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle

class TomorrowScheduleWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        val helper = ScheduleWidgetHelper(context, showTomorrow = true)
        for (id in appWidgetIds) helper.updateWidget(id, manager)
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle?
    ) {
        ScheduleWidgetHelper(context, showTomorrow = true).updateWidget(appWidgetId, manager)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        when (intent.action) {
            Intent.ACTION_DATE_CHANGED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> {
                val manager = AppWidgetManager.getInstance(context)
                onUpdate(context, manager, manager.getAppWidgetIds(
                    ComponentName(context, TomorrowScheduleWidgetProvider::class.java)
                ))
            }
        }
    }
}
