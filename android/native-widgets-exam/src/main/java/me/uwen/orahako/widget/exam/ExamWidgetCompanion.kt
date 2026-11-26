package me.uwen.orahako.widget.exam

import android.appwidget.AppWidgetManager
import android.content.Context
import me.uwen.orahako.widget.NativeWidgetDeclaration
import me.uwen.orahako.widget.SharedPreferencesNativeWidgetStore
import me.uwen.orahako.widget.UnknownNativeWidgetException

/**
 * Exam widget declarations. Both providers share one declarative exam snapshot.
 */
object ExamWidgetCompanion {
    const val CAPABILITY_ID = "widgets.exam"
    const val EXAM_WIDGET_ID = "exam"
    const val COMPACT_WIDGET_ID = "exam-compact"

    val WIDGET_IDS: List<String> = listOf(EXAM_WIDGET_ID, COMPACT_WIDGET_ID)

    val declarations: List<NativeWidgetDeclaration> = listOf(
        NativeWidgetDeclaration(
            id = EXAM_WIDGET_ID,
            providerClass = ExamWidgetProvider::class.java,
            renderer = ExamWidgetRenderer(compact = false),
            capabilityId = CAPABILITY_ID,
        ),
        NativeWidgetDeclaration(
            id = COMPACT_WIDGET_ID,
            providerClass = ExamWidget2x2Provider::class.java,
            renderer = ExamWidgetRenderer(compact = true),
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
