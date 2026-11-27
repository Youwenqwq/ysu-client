package me.uwen.orahako.nativebridge.official

import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityCompositionException
import me.uwen.orahako.nativebridge.NativeCapabilityCompositionModule
import me.uwen.orahako.nativebridge.NativeCapabilityCompositionModules
import me.uwen.orahako.nativebridge.NativeCapabilityFactories
import me.uwen.orahako.nativebridge.NativeCapabilityFactory
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeCompanionConfig
import me.uwen.orahako.nativebridge.NativeComposition
import me.uwen.orahako.nativebridge.NativeCompositionProvider
import me.uwen.orahako.nativebridge.capabilities.FilesCapability
import me.uwen.orahako.nativebridge.capabilities.WebViewCapability
import me.uwen.orahako.nativebridge.capabilities.background.BackgroundTasksCapability
import me.uwen.orahako.nativebridge.capabilities.calendar.CalendarSyncCapability
import me.uwen.orahako.nativebridge.capabilities.geolocation.GeolocationCapability
import me.uwen.orahako.nativebridge.capabilities.notifications.NotificationsCoreCapability
import me.uwen.orahako.notify.ClassRemindersCapability
import me.uwen.orahako.widget.AndroidWidgetsController
import me.uwen.orahako.widget.NativeWidgetCompositionModule
import me.uwen.orahako.widget.NativeWidgetDeclaration
import me.uwen.orahako.widget.NativeWidgetDeclarations
import me.uwen.orahako.widget.WidgetsCapability

/**
 * Build-time native choices of the official application.
 *
 * Every capability registered here is a generic OS primitive — no school- or
 * provider-specific Kotlin companion is required. Background tasks run
 * plugin-supplied JavaScript inside QuickJS via `background.tasks@1`.
 */
object OfficialNativeComposition : NativeCapabilityFactories, NativeCompositionProvider {

    private val baseFactories: Map<String, NativeCapabilityFactory> = linkedMapOf(
        FilesCapability.ID to { host, config -> FilesCapability(host, config) },
        WebViewCapability.ID to { host, config -> WebViewCapability(host, config) },
        GeolocationCapability.ID to { host, config -> GeolocationCapability(host, config) },
        CalendarSyncCapability.ID to { host, config -> CalendarSyncCapability(host, config) },
        BackgroundTasksCapability.ID to { host, config -> BackgroundTasksCapability(host, config) },
        NotificationsCoreCapability.ID to { host, config ->
            NotificationsCoreCapability(host, config)
        },
        ClassRemindersCapability.ID to { host, config ->
            ClassRemindersCapability(host, config)
        },
    )

    /** Optional composition modules selected by nativeComposition.gradle. */
    private val compositionModules: List<NativeCapabilityCompositionModule> by lazy {
        NativeCapabilityCompositionModules.load(
            BuildConfig.NATIVE_CAPABILITY_COMPOSITION_MODULES
                .split(',')
                .map(String::trim)
                .filter(String::isNotEmpty)
        )
    }

    override fun createFactories(): NativeCapabilityFactories = this

    override fun create(
        host: NativeCapabilityHost,
        entries: List<NativeCompanionConfig.Entry>,
    ): List<NativeCapability> {
        val modules = compositionModules
        val enabledIds = entries.mapTo(LinkedHashSet()) { it.id }
        NativeWidgetDeclarations.activate(declarationsOf(modules, enabledIds))

        val factories = LinkedHashMap(baseFactories)
        addFactory(factories, WidgetsCapability.ID) { capabilityHost, config ->
            WidgetsCapability(
                config,
                AndroidWidgetsController(
                    capabilityHost.context,
                    NativeWidgetDeclarations.snapshot(),
                    pinTimeoutMs(config),
                ),
            )
        }
        for ((id, factory) in NativeCapabilityCompositionModules.factories(modules)) {
            addFactory(factories, id, factory)
        }

        return entries.map { entry ->
            val factory = factories[entry.id] ?: throw NativeCapabilityCompositionException(
                "No native factory for enabled capability: ${entry.qualifiedId}"
            )
            val capability = factory(host, entry.config)
            if (capability.id != entry.id || capability.version != entry.version) {
                throw NativeCapabilityCompositionException(
                    "Native factory mismatch: ${entry.qualifiedId} produced " +
                        "${capability.id}@${capability.version}"
                )
            }
            capability
        }
    }

    /**
     * Installs this composition for the mounted bridge, background workers and
     * the generic companion reconciler.
     */
    fun install() {
        NativeComposition.install(this)
    }

    private fun declarationsOf(
        modules: List<NativeCapabilityCompositionModule>,
        enabledIds: Set<String>,
    ): List<NativeWidgetDeclaration> =
        modules.filterIsInstance<NativeWidgetCompositionModule>()
            .flatMap { it.declaredWidgets }
            .filter { it.capabilityId in enabledIds }

    private fun addFactory(
        factories: MutableMap<String, NativeCapabilityFactory>,
        id: String,
        factory: NativeCapabilityFactory,
    ) {
        if (factories.put(id, factory) != null) {
            throw NativeCapabilityCompositionException(
                "Duplicate native capability factory for enabled capability id: $id"
            )
        }
    }

    private fun pinTimeoutMs(config: Map<String, Any?>): Long =
        (config["pinTimeoutMs"] as? Number)?.toLong()?.takeIf { it > 0L }
            ?: AndroidWidgetsController.DEFAULT_PIN_TIMEOUT_MS
}
