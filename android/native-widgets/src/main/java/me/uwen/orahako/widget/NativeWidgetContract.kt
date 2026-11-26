package me.uwen.orahako.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import org.json.JSONObject

/** A widget id was not declared by any enabled widget companion capability. */
class UnknownNativeWidgetException(widgetId: String) :
    IllegalArgumentException("Unknown native widget: $widgetId")

/**
 * Declarative data rendered by a widget implementation. The generic host never
 * inspects these fields: it stores whatever snapshot JavaScript sends and hands
 * it to the owning renderer.
 */
data class NativeWidgetState(
    val snapshot: JSONObject? = null,
    val settings: JSONObject? = null,
    val updatedAt: Long = 0L,
) {
    val hasSnapshot: Boolean
        get() = snapshot != null && updatedAt > 0L
}

fun interface NativeWidgetRenderer {
    fun render(
        context: Context,
        appWidgetId: Int,
        manager: AppWidgetManager,
        state: NativeWidgetState,
    )
}

/**
 * One home-screen widget declared by a companion capability. Widget ids are
 * open strings; the generic host never switches on official ids.
 */
data class NativeWidgetDeclaration(
    val id: String,
    val providerClass: Class<out AppWidgetProvider>,
    val renderer: NativeWidgetRenderer,
    /** Owning capability id, reported for diagnostics only. */
    val capabilityId: String,
)

class NativeWidgetCatalog(declarations: List<NativeWidgetDeclaration> = emptyList()) {
    private val ordered = LinkedHashMap<String, NativeWidgetDeclaration>()

    init {
        declarations.forEach(::register)
    }

    fun register(declaration: NativeWidgetDeclaration) {
        if (ordered.containsKey(declaration.id)) {
            throw IllegalArgumentException("Duplicate native widget: ${declaration.id}")
        }
        ordered[declaration.id] = declaration
    }

    fun declarations(): List<NativeWidgetDeclaration> = ordered.values.toList()

    fun widgetIds(): List<String> = ordered.keys.toList()

    fun resolve(widgetId: String): NativeWidgetDeclaration =
        ordered[widgetId] ?: throw UnknownNativeWidgetException(widgetId)
}

/**
 * Stored widget ids that no enabled companion declares any more. Their
 * snapshots must be dropped so a disabled capability cannot leave stale data
 * behind.
 */
internal fun staleWidgetIds(
    stored: Collection<String>,
    declared: Collection<String>,
): Set<String> {
    val owned = declared.toSet()
    return stored.filterNot(owned::contains).toSet()
}
