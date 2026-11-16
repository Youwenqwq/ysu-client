package me.uwen.orahako.nativebridge

/**
 * A module that contributes capability factories to a composition without the
 * composition module depending on it statically.
 *
 * Composition modules are listed by class name in the auditable build metadata,
 * so a build can select a generic module (for example the generic widget host)
 * without selecting any of its optional companions.
 */
interface NativeCapabilityCompositionModule {

    /** Factories keyed by stable capability id. */
    val factories: Map<String, NativeCapabilityFactory>
}

/**
 * Loads composition modules by their auditable class names.
 *
 * Missing classes, classes outside the contract and duplicate capability ids
 * fail deterministically; a composition never silently loses a module.
 */
object NativeCapabilityCompositionModules {

    fun load(classNames: List<String>): List<NativeCapabilityCompositionModule> {
        val seen = LinkedHashSet<String>()
        return classNames.map { raw ->
            val className = raw.trim()
            if (className.isEmpty()) {
                throw NativeCapabilityCompositionException(
                    "Native composition module class name must not be blank"
                )
            }
            if (!seen.add(className)) {
                throw NativeCapabilityCompositionException(
                    "Duplicate native composition module: $className"
                )
            }
            val type = classForName(className)
            instantiateCompositionSingleton(
                type,
                NativeCapabilityCompositionModule::class.java,
                "Native composition module",
            )
        }
    }

    /** Merges every module's factories, rejecting duplicate capability ids. */
    fun factories(
        modules: List<NativeCapabilityCompositionModule>,
    ): Map<String, NativeCapabilityFactory> {
        val merged = LinkedHashMap<String, NativeCapabilityFactory>()
        for (module in modules) {
            for ((id, factory) in module.factories) {
                if (id.isBlank()) {
                    throw NativeCapabilityCompositionException(
                        "Native composition module ${module.javaClass.name} declares a blank capability id"
                    )
                }
                if (merged.put(id, factory) != null) {
                    throw NativeCapabilityCompositionException(
                        "Duplicate native capability factory for enabled capability id: $id"
                    )
                }
            }
        }
        return merged
    }

    private fun classForName(className: String): Class<*> = try {
        Class.forName(className)
    } catch (error: ClassNotFoundException) {
        throw NativeCapabilityCompositionException(
            "Missing native composition module: $className",
            error,
        )
    } catch (error: LinkageError) {
        throw NativeCapabilityCompositionException(
            "Unloadable native composition module: $className (${error.message})",
            error,
        )
    }
}
