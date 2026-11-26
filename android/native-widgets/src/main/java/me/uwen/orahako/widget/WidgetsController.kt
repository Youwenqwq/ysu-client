package me.uwen.orahako.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Data and lifecycle operations shared by the generic widget capability and the
 * schedule/exam companions. Widget dispatch is always by open string id through
 * the catalog; no official widget id appears in this interface.
 */
interface WidgetsController {
    fun declarations(): List<NativeWidgetDeclaration>
    fun update(widgetIds: List<String>, snapshot: JSONObject, settings: JSONObject?)
    fun updateSettings(widgetIds: List<String>, settings: JSONObject)
    fun clear(widgetIds: List<String>?)
    fun refresh(widgetIds: List<String>?)
    fun reconcile()
    fun requestPin(widgetId: String, onResult: (Boolean) -> Unit)
    fun release()
}

class AndroidWidgetsController(
    private val context: Context,
    declarations: List<NativeWidgetDeclaration>,
    private val pinTimeoutMs: Long = DEFAULT_PIN_TIMEOUT_MS,
    private val store: NativeWidgetStore = SharedPreferencesNativeWidgetStore(context),
) : WidgetsController {

    private val catalog = NativeWidgetCatalog(declarations)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingPin: PendingPin? = null

    init {
        require(pinTimeoutMs > 0L) { "Widget pin timeout must be positive" }
    }

    override fun declarations(): List<NativeWidgetDeclaration> = catalog.declarations()

    override fun update(
        widgetIds: List<String>,
        snapshot: JSONObject,
        settings: JSONObject?,
    ) {
        val targets = resolveIds(widgetIds)
        val now = System.currentTimeMillis()
        for (widgetId in targets) {
            store.writeSnapshot(widgetId, snapshot, now)
            if (settings != null) store.writeSettings(widgetId, settings)
        }
        refresh(targets)
    }

    override fun updateSettings(widgetIds: List<String>, settings: JSONObject) {
        val targets = resolveIds(widgetIds)
        for (widgetId in targets) store.writeSettings(widgetId, settings)
        refresh(targets)
    }

    override fun clear(widgetIds: List<String>?) {
        if (widgetIds == null) {
            val targets = catalog.widgetIds()
            store.clearAll()
            refresh(targets)
            return
        }
        val targets = resolveIds(widgetIds)
        for (widgetId in targets) store.clear(widgetId)
        refresh(targets)
    }

    override fun refresh(widgetIds: List<String>?) {
        val targets = widgetIds ?: catalog.widgetIds()
        if (targets.isEmpty()) return
        val manager = AppWidgetManager.getInstance(context)
        for (widgetId in targets) {
            val declaration = catalog.resolve(widgetId)
            val state = store.readState(widgetId)
            val appWidgetIds = manager.getAppWidgetIds(
                ComponentName(context, declaration.providerClass)
            )
            for (appWidgetId in appWidgetIds) {
                declaration.renderer.render(context, appWidgetId, manager, state)
            }
        }
    }

    /**
     * Drops snapshots whose widget id is no longer declared by an enabled
     * companion capability, then repaints every live widget from the store.
     */
    override fun reconcile() {
        pruneUnowned()
        refresh(null)
    }

    override fun requestPin(widgetId: String, onResult: (Boolean) -> Unit) {
        val declaration = catalog.resolve(widgetId)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            onResult(false)
            return
        }
        val manager = AppWidgetManager.getInstance(context)
        if (!manager.isRequestPinAppWidgetSupported) {
            onResult(false)
            return
        }

        cancelPendingPin(added = false)
        val component = ComponentName(context, declaration.providerClass)
        val previousIds = manager.getAppWidgetIds(component).toSet()
        val action = "${context.packageName}.widget.PIN_${System.nanoTime()}"
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context?, intent: Intent?) {
                resolvePendingPin(added = true)
            }
        }
        try {
            ContextCompat.registerReceiver(
                context,
                receiver,
                IntentFilter(action),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
        } catch (_: Exception) {
            onResult(false)
            return
        }

        val pending = PendingPin(receiver, previousIds, declaration, onResult)
        pendingPin = pending
        mainHandler.post {
            try {
                val successCallback = PendingIntent.getBroadcast(
                    context,
                    PIN_REQUEST_CODE,
                    Intent(action).setPackage(context.packageName),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                val accepted = manager.requestPinAppWidget(component, null, successCallback)
                if (!accepted) {
                    resolvePendingPin(added = false)
                    return@post
                }
                val timeout = Runnable { resolvePendingPin(fallbackPinAdded(pending)) }
                pending.timeout = timeout
                mainHandler.postDelayed(timeout, pinTimeoutMs)
            } catch (_: Exception) {
                resolvePendingPin(added = false)
            }
        }
    }

    override fun release() {
        cancelPendingPin(added = false)
        pruneUnowned()
    }

    private fun resolveIds(widgetIds: List<String>): List<String> {
        require(widgetIds.isNotEmpty()) { "At least one widget id is required" }
        return widgetIds.map { catalog.resolve(it).id }.distinct()
    }

    private fun pruneUnowned() {
        staleWidgetIds(store.storedWidgetIds(), catalog.widgetIds()).forEach(store::clear)
    }

    private fun fallbackPinAdded(pending: PendingPin): Boolean {
        val manager = AppWidgetManager.getInstance(context)
        val current = manager.getAppWidgetIds(ComponentName(context, pending.declaration.providerClass))
        return current.any { it !in pending.previousIds }
    }

    private fun cancelPendingPin(added: Boolean) {
        if (pendingPin != null) resolvePendingPin(added)
    }

    private fun resolvePendingPin(added: Boolean) {
        val pending = pendingPin ?: return
        pendingPin = null
        pending.timeout?.let(mainHandler::removeCallbacks)
        try {
            context.unregisterReceiver(pending.receiver)
        } catch (_: IllegalArgumentException) {
            // Receiver was already unregistered.
        }
        pending.onResult(added)
    }

    private class PendingPin(
        val receiver: BroadcastReceiver,
        val previousIds: Set<Int>,
        val declaration: NativeWidgetDeclaration,
        val onResult: (Boolean) -> Unit,
    ) {
        var timeout: Runnable? = null
    }

    companion object {
        const val DEFAULT_PIN_TIMEOUT_MS = 60_000L
        private const val PIN_REQUEST_CODE = 4101
    }
}
