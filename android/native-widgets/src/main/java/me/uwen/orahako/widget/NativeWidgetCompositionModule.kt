package me.uwen.orahako.widget

import me.uwen.orahako.nativebridge.NativeCapabilityCompositionModule

/**
 * Composition contribution of a widget companion (schedule, exam or a
 * community widget implementation).
 *
 * The generic host owns only open string ids and the declarative store; a
 * companion declares the widgets it serves and the factories of the
 * capabilities that publish into them.
 */
interface NativeWidgetCompositionModule : NativeCapabilityCompositionModule {

    /** Widgets served by the companion, keyed by the owning capability id. */
    val declaredWidgets: List<NativeWidgetDeclaration>
}

/**
 * Widgets declared by the enabled widget companions of the current composition.
 *
 * The official composition activates the declarations of the companions it
 * selected before creating the generic capability, so the generic host can
 * list and reconcile widgets without importing any concrete companion.
 */
object NativeWidgetDeclarations {

    @Volatile
    private var active: List<NativeWidgetDeclaration> = emptyList()

    /** Replaces the active set; duplicate widget ids fail deterministically. */
    @Synchronized
    fun activate(declarations: List<NativeWidgetDeclaration>) {
        val byId = LinkedHashMap<String, NativeWidgetDeclaration>()
        for (declaration in declarations) {
            if (byId.put(declaration.id, declaration) != null) {
                throw IllegalArgumentException("Duplicate native widget: ${declaration.id}")
            }
        }
        active = byId.values.toList()
    }

    fun snapshot(): List<NativeWidgetDeclaration> = active
}
