package me.uwen.orahako.nativebridge

import java.util.concurrent.atomic.AtomicBoolean

/**
 * Deterministic capability composition and lifetime owner.
 *
 * Construction validates ids, versions, dependency existence and cycles in
 * declaration order. [`acquire`] builds bindings lazily, refcounts leases and
 * keeps dependency leases owned by the dependent binding. [`invoke`] takes a
 * temporary lease so every call releases what it created, even when the
 * capability settles from another thread.
 */
class NativeCapabilityRegistry(capabilities: List<NativeCapability>) {

    private class ActiveBinding(
        val binding: NativeCapabilityBinding,
        var references: Int,
        val dependencies: List<NativeCapabilityLease>,
    )

    private val capabilitiesById: LinkedHashMap<String, NativeCapability>
    private val resolvedDependencies: Map<String, List<NativeCapability>>
    private val descriptors: List<NativeCapabilityDescriptor>

    private val active = LinkedHashMap<String, ActiveBinding>()
    private val leases = LinkedHashMap<Long, String>()
    private var nextToken = 1L

    init {
        val byId = LinkedHashMap<String, NativeCapability>()
        for (capability in capabilities) {
            validateDeclaration(capability)
            if (byId.put(capability.id, capability) != null) {
                throw NativeCapabilityCompositionException(
                    "Duplicate native capability: ${capability.qualifiedId}"
                )
            }
        }
        capabilitiesById = byId

        val dependencies = LinkedHashMap<String, List<NativeCapability>>()
        for (capability in byId.values) {
            val seen = LinkedHashSet<String>()
            val resolved = ArrayList<NativeCapability>(capability.dependencies.size)
            for (reference in capability.dependencies) {
                val dependency = resolveDependency(capability, reference)
                if (!seen.add(dependency.id)) {
                    throw NativeCapabilityCompositionException(
                        "Duplicate dependency ${dependency.qualifiedId} of native capability ${capability.qualifiedId}"
                    )
                }
                resolved.add(dependency)
            }
            dependencies[capability.id] = resolved
        }
        resolvedDependencies = dependencies
        val ordered = topologicalOrder(byId, dependencies)
        descriptors = ordered.map { capability ->
            NativeCapabilityDescriptor(
                id = capability.id,
                version = capability.version,
                methods = capability.methods.sorted(),
                dependencies = resolvedDependencies.getValue(capability.id)
                    .map { it.qualifiedId },
                config = capability.config,
            )
        }
    }

    fun describe(): List<NativeCapabilityDescriptor> = descriptors

    fun has(reference: String): Boolean = try {
        resolveCapability(reference)
        true
    } catch (_: UnknownNativeCapabilityException) {
        false
    }

    /** Resolves `id` and `id@version` references; unknown references fail deterministically. */
    fun resolveCapability(reference: String): NativeCapability {
        val (id, version) = parseCapabilityReference(reference)
        val capability = capabilitiesById[id]
            ?: throw UnknownNativeCapabilityException(reference)
        if (version != null && version != capability.version) {
            throw UnknownNativeCapabilityException(reference)
        }
        return capability
    }

    @Synchronized
    fun acquire(reference: String): NativeCapabilityLease =
        acquireCapability(resolveCapability(reference))

    /**
     * Releases one lease. Returns false for an unknown or already released
     * token; a binding is released exactly once, when its last reference drops.
     */
    @Synchronized
    fun release(token: Long): Boolean = releaseLease(token)

    /** Releases every outstanding lease; safe to call more than once. */
    @Synchronized
    fun dispose() {
        for (token in leases.keys.sorted()) {
            releaseLease(token)
        }
    }

    @Synchronized
    fun activeReferences(reference: String): Int =
        active[resolveCapability(reference).id]?.references ?: 0

    /**
     * Invokes one method through a temporary lease. Unknown capability and
     * method names throw synchronously; capability failures settle [result].
     */
    fun invoke(
        reference: String,
        method: String,
        payload: Map<String, Any?>,
        result: NativeInvokeResult,
    ) {
        val capability = resolveCapability(reference)
        if (method !in capability.methods) {
            throw UnknownNativeCapabilityMethodException(capability.id, method)
        }

        val lease = acquire(capability.id)
        val binding = synchronized(this) {
            active[capability.id]?.binding
        } ?: run {
            release(lease.token)
            throw NativeCapabilityCompositionException(
                "Native capability binding is unavailable: ${capability.qualifiedId}"
            )
        }

        val settled = AtomicBoolean(false)
        val releaseGate = Any()
        var invokeReturned = false
        var releasePending = false

        fun requestRelease() {
            val releaseNow = synchronized(releaseGate) {
                if (invokeReturned) {
                    true
                } else {
                    releasePending = true
                    false
                }
            }
            if (releaseNow) release(lease.token)
        }

        val invocationResult = object : NativeInvokeResult {
            override fun resolve(value: Any?) {
                settle { result.resolve(value) }
            }

            override fun reject(message: String, cause: Throwable?) {
                settle { result.reject(message, cause) }
            }

            private fun settle(deliver: () -> Unit) {
                if (!settled.compareAndSet(false, true)) return
                try {
                    deliver()
                } finally {
                    requestRelease()
                }
            }
        }

        try {
            binding.invoke(method, payload, invocationResult)
        } catch (error: Exception) {
            invocationResult.reject(
                "Native capability invocation failed: ${error.message ?: error.javaClass.simpleName}",
                error,
            )
        } finally {
            val releaseNow = synchronized(releaseGate) {
                invokeReturned = true
                releasePending
            }
            if (releaseNow) release(lease.token)
        }
    }

    private fun acquireCapability(capability: NativeCapability): NativeCapabilityLease {
        val existing = active[capability.id]
        if (existing != null) {
            existing.references += 1
            return newLease(capability)
        }

        val dependencies = ArrayList<NativeCapabilityLease>()
        val binding = try {
            for (dependency in resolvedDependencies.getValue(capability.id)) {
                dependencies.add(acquireCapability(dependency))
            }
            capability.bind()
        } catch (error: Exception) {
            dependencies.asReversed().forEach { releaseLease(it.token) }
            throw error
        }
        active[capability.id] = ActiveBinding(binding, 1, dependencies)
        return newLease(capability)
    }

    private fun releaseLease(token: Long): Boolean {
        val capabilityId = leases.remove(token) ?: return false
        val entry = active[capabilityId]
        if (entry == null) return false
        entry.references -= 1
        if (entry.references > 0) return true

        active.remove(capabilityId)
        try {
            entry.binding.release()
        } finally {
            entry.dependencies.asReversed().forEach { releaseLease(it.token) }
        }
        return true
    }

    private fun newLease(capability: NativeCapability): NativeCapabilityLease {
        val token = nextToken++
        leases[token] = capability.id
        return NativeCapabilityLease(
            capabilityId = capability.id,
            version = capability.version,
            token = token,
            dependencies = resolvedDependencies.getValue(capability.id).map { it.qualifiedId },
        )
    }

    private fun resolveDependency(owner: NativeCapability, reference: String): NativeCapability {
        val (id, version) = parseCapabilityReference(reference)
        val dependency = capabilitiesById[id] ?: throw NativeCapabilityCompositionException(
            "Native capability ${owner.qualifiedId} depends on missing capability $reference"
        )
        if (version != null && version != dependency.version) {
            throw NativeCapabilityCompositionException(
                "Native capability ${owner.qualifiedId} depends on unavailable version $reference " +
                    "(available: ${dependency.qualifiedId})"
            )
        }
        return dependency
    }

    private fun topologicalOrder(
        byId: LinkedHashMap<String, NativeCapability>,
        dependencies: Map<String, List<NativeCapability>>,
    ): List<NativeCapability> {
        val ordered = ArrayList<NativeCapability>(byId.size)
        val state = HashMap<String, VisitState>()
        val path = ArrayList<String>()

        fun visit(id: String) {
            when (state[id]) {
                VisitState.DONE -> return
                VisitState.VISITING -> {
                    val start = path.indexOf(id)
                    val cycle = path.subList(start, path.size) + id
                    throw NativeCapabilityCompositionException(
                        "Native capability dependency cycle: ${cycle.joinToString(" -> ")}"
                    )
                }
                null -> Unit
            }
            state[id] = VisitState.VISITING
            path.add(id)
            dependencies.getValue(id).forEach { visit(it.id) }
            path.removeAt(path.size - 1)
            state[id] = VisitState.DONE
            ordered.add(byId.getValue(id))
        }

        byId.keys.forEach(::visit)
        return ordered
    }

    private enum class VisitState { VISITING, DONE }

    private fun validateDeclaration(capability: NativeCapability) {
        if (CAPABILITY_ID.matchEntire(capability.id) == null) {
            throw NativeCapabilityCompositionException(
                "Invalid native capability id: ${capability.id}"
            )
        }
        if (capability.version < 1) {
            throw NativeCapabilityCompositionException(
                "Invalid native capability version: ${capability.qualifiedId}"
            )
        }
        if (capability.methods.isEmpty()) {
            throw NativeCapabilityCompositionException(
                "Native capability declares no methods: ${capability.qualifiedId}"
            )
        }
        for (method in capability.methods) {
            if (!METHOD_NAME.matches(method)) {
                throw NativeCapabilityCompositionException(
                    "Invalid native capability method: ${capability.qualifiedId}.$method"
                )
            }
        }
    }

    companion object {
        private val CAPABILITY_ID = Regex("[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*")
        private val METHOD_NAME = Regex("[A-Za-z][A-Za-z0-9_]*")
    }
}

/** Parses `id` / `id@version`; malformed versions are unknown references. */
internal fun parseCapabilityReference(reference: String): Pair<String, Int?> {
    val separator = reference.lastIndexOf('@')
    if (separator < 0) return reference to null
    if (separator == 0) throw UnknownNativeCapabilityException(reference)
    val version = reference.substring(separator + 1).toIntOrNull()
        ?: throw UnknownNativeCapabilityException(reference)
    return reference.substring(0, separator) to version
}

/** One acquired capability reference. Owning code must release it exactly once. */
class NativeCapabilityLease internal constructor(
    val capabilityId: String,
    val version: Int,
    val token: Long,
    val dependencies: List<String>,
)
