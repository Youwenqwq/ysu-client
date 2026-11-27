package me.uwen.orahako.nativebridge

/**
 * A versioned native capability.
 *
 * The generic registry knows nothing about the app's business logic: it
 * validates the declared dependency graph, builds bindings on demand, and
 * routes method invocations. Concrete capabilities and their factories live in
 * the official composition package.
 */
typealias NativeCapabilityFactory = (NativeCapabilityHost, Map<String, Any?>) -> NativeCapability

interface NativeCapability {
    val id: String
    val version: Int
    val methods: Set<String>

    /** Capability references (`id` or `id@version`) that must be active first. */
    val dependencies: List<String> get() = emptyList()

    /** Static configuration copied verbatim into [NativeCapabilityDescriptor]. */
    val config: Map<String, Any?> get() = emptyMap()

    /** Creates the process-scoped binding owned by a registry lease. */
    fun bind(): NativeCapabilityBinding
}

val NativeCapability.qualifiedId: String
    get() = "$id@$version"

/**
 * Lightweight startup hook for capabilities that declare OS metadata (such as
 * Android notification channels) that should exist as soon as the app launches
 * or notification permissions are granted, without waiting for the first
 * background task or user toggle.
 */
interface NativeCapabilityInitializer {
    fun initialize()
}

/**
 * Re-applies the capability's persisted desired state after a reboot, an app
 * update or a clock change. Implemented by capabilities that own OS-level
 * schedules (alarms, periodic work); the generic reconciler receiver calls it
 * through the official composition.
 */
interface NativeCapabilityReconciler {
    fun reconcile()
}

/**
 * Mutable state of one bound capability. Invocations may settle later from any
 * thread; the registry releases the binding only after the last lease is gone.
 */
interface NativeCapabilityBinding {
    fun invoke(method: String, payload: Map<String, Any?>, result: NativeInvokeResult)

    /** Releases resources owned by this binding. Called exactly once per binding. */
    fun release()
}

/**
 * Completion of one capability invocation. Only the first `resolve` or
 * `reject` wins; later attempts are ignored so a capability cannot release its
 * invocation lease twice.
 *
 * The bridge resolves map values directly into the JavaScript result object;
 * other non-null values are wrapped as `{ value }`.
 */
interface NativeInvokeResult {
    fun resolve(value: Any?)
    fun reject(message: String, cause: Throwable? = null)
}

class NativeCapabilityCompositionException(
    message: String,
    cause: Throwable? = null,
) : IllegalStateException(message, cause)

class UnknownNativeCapabilityException(reference: String) :
    IllegalArgumentException("Unknown native capability: $reference")

class UnknownNativeCapabilityMethodException(capabilityId: String, method: String) :
    IllegalArgumentException("Unknown native capability method: $capabilityId.$method")
