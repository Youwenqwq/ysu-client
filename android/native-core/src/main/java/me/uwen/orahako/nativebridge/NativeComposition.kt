package me.uwen.orahako.nativebridge

import android.content.Context
import android.util.Log

/**
 * Build-time composition seam.
 *
 * The generic registry, the mounted bridge and the reconciler receiver never
 * name an official capability. The host application installs the factories
 * selected by its build (for the official build:
 * `native-official`'s `OfficialNativeComposition`) during `Application.onCreate`,
 * so bridge startup, scheduled work in a fresh process and boot reconciliation
 * all resolve the same capability set.
 */
interface NativeCapabilityFactories {

    /** Instantiates the enabled capabilities in the order of the companion config. */
    fun create(
        host: NativeCapabilityHost,
        entries: List<NativeCompanionConfig.Entry>,
    ): List<NativeCapability>

    /**
     * Registers process-wide adapters that scheduled work resolves by id. Called
     * on install and once more before reconciliation, because a fresh process
     * may only run a background worker.
     */
    fun installBackgroundTaskHandlers() = Unit
}

/**
 * Process-scoped holder of the installed composition plus the generic
 * reconciliation pass shared by every composition.
 */
object NativeComposition {

    private const val TAG = "OrahakoNativeComposition"

    @Volatile
    private var factories: NativeCapabilityFactories? = null

    /** Installs the build-selected composition and its background adapters. */
    fun install(factories: NativeCapabilityFactories) {
        this.factories = factories
        factories.installBackgroundTaskHandlers()
    }

    /**
     * Installs the composition provider named by the host build configuration.
     * A blank name, a missing class, a class outside [NativeCompositionProvider]
     * or an unconstructible provider all fail loudly: a host can never start
     * with an empty composition by accident.
     */
    fun installFromProvider(providerClassName: String) {
        val className = providerClassName.trim()
        if (className.isEmpty()) {
            throw NativeCapabilityCompositionException(
                "Native composition provider is not configured for this build"
            )
        }
        val type = try {
            Class.forName(className)
        } catch (error: ClassNotFoundException) {
            throw NativeCapabilityCompositionException(
                "Missing native composition provider: $className",
                error,
            )
        } catch (error: LinkageError) {
            throw NativeCapabilityCompositionException(
                "Unloadable native composition provider: $className (${error.message})",
                error,
            )
        }
        val provider = instantiateCompositionSingleton(
            type,
            NativeCompositionProvider::class.java,
            "Native composition provider",
        )
        install(provider.createFactories())
    }

    /** The installed composition; an uninstalled process fails loudly instead of degrading. */
    fun require(): NativeCapabilityFactories = factories
        ?: throw NativeCapabilityCompositionException(
            "Native composition is not installed: the host application must install its " +
                "native capability factories before the bridge is created"
        )

    /**
     * Rebuilds the enabled capabilities from the auditable asset and lets every
     * capability that owns OS schedules re-apply its persisted desired state.
     * Used after boot, app updates and clock/timezone changes; a failure is
     * logged so one broken capability cannot crash the broadcast receiver.
     */
    fun reconcile(context: Context) {
        val appContext = context.applicationContext
        val composition = factories
        if (composition == null) {
            Log.e(TAG, "Unable to reconcile: the native composition is not installed")
            return
        }
        composition.installBackgroundTaskHandlers()
        val config = try {
            NativeCompanionConfig.load(appContext)
        } catch (error: Exception) {
            Log.e(TAG, "Unable to load the native companion config", error)
            return
        }
        val capabilities = try {
            composition.create(ContextNativeCapabilityHost(appContext), config.entries)
        } catch (error: Exception) {
            Log.e(TAG, "Unable to compose native capabilities for reconciliation", error)
            return
        }
        for (capability in capabilities) {
            if (capability !is NativeCapabilityReconciler) continue
            try {
                capability.reconcile()
            } catch (error: Exception) {
                Log.e(TAG, "Unable to reconcile ${capability.qualifiedId}", error)
            }
        }
    }
}
