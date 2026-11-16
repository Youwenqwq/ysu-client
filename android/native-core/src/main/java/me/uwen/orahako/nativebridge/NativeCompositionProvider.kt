package me.uwen.orahako.nativebridge

/**
 * Build-selected entry point of a native composition.
 *
 * The host application never imports a concrete composition: it instantiates
 * the provider class named by its generated build configuration and installs
 * the factories it returns through [NativeComposition]. A missing, blank or
 * non-conforming provider fails loudly instead of degrading to an empty
 * composition.
 */
interface NativeCompositionProvider {

    /** Factories and background adapters selected by this build. */
    fun createFactories(): NativeCapabilityFactories
}

/**
 * Instantiates a Kotlin `object` (through its `INSTANCE` field) or a Java/Kotlin
 * class with an accessible no-argument constructor.
 */
internal fun <T : Any> instantiateCompositionSingleton(
    type: Class<*>,
    contract: Class<T>,
    role: String,
): T {
    if (!contract.isAssignableFrom(type)) {
        throw NativeCapabilityCompositionException(
            "$role ${type.name} must implement ${contract.name}"
        )
    }
    val instance = runCatching {
        type.getDeclaredField("INSTANCE").apply { isAccessible = true }.get(null)
    }.getOrNull() ?: try {
        type.getDeclaredConstructor().apply { isAccessible = true }.newInstance()
    } catch (error: Exception) {
        throw NativeCapabilityCompositionException(
            "$role ${type.name} has no accessible no-argument constructor or INSTANCE",
            error,
        )
    }
    return contract.cast(instance)
}
