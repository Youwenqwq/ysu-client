package me.uwen.orahako.nativebridge.capabilities.polling

import android.content.Context
import org.json.JSONObject

/**
 * Adapter SPI for the generic polling scheduler.
 *
 * The scheduler only persists an interval and an opaque payload, enqueues
 * WorkManager work and cancels it again. Everything school- or feature-specific
 * (HTTP protocol, diffing, notification copy, cache) lives behind a handler
 * registered by the official composition. There is deliberately no default
 * handler: an unregistered id fails instead of falling back to another module.
 */
interface BackgroundTaskHandler {
    val id: String

    /** Runs one scheduled pass. The payload is the opaque JSON supplied at configuration time. */
    fun run(context: Context, payload: JSONObject): BackgroundTaskResult

    /** Diagnostics exposed through `academic.polling.inspect`; never used for scheduling. */
    fun inspect(context: Context): Map<String, Any?> = emptyMap()

    /** Drops every piece of persistent state owned by this handler. */
    fun clear(context: Context) = Unit
}

enum class BackgroundTaskResult {
    SUCCESS,
    RETRY,
    SKIPPED,
}

class UnknownBackgroundTaskHandlerException(handlerId: String) :
    IllegalArgumentException("Unknown background task handler: $handlerId")

/**
 * Process-wide handler registry. Registration happens once in
 * `OfficialNativeComposition.install`, so scheduled work can resolve its
 * adapter in a fresh worker process too.
 */
object BackgroundTaskHandlers {
    private val handlers = LinkedHashMap<String, BackgroundTaskHandler>()

    @Synchronized
    fun register(handler: BackgroundTaskHandler) {
        require(handler.id.isNotBlank()) { "Background task handler id must not be blank" }
        handlers[handler.id] = handler
    }

    @Synchronized
    fun find(id: String): BackgroundTaskHandler? = handlers[id]

    @Synchronized
    fun registeredIds(): List<String> = handlers.keys.toList()

    /** Test seam: the app never clears the registry at runtime. */
    @Synchronized
    fun clear() {
        handlers.clear()
    }
}

object BackgroundTaskDispatch {

    /** Resolves the configured adapter; an unknown id is an error, not a fallback. */
    fun resolve(handlerId: String): BackgroundTaskHandler =
        BackgroundTaskHandlers.find(handlerId)
            ?: throw UnknownBackgroundTaskHandlerException(handlerId)

    fun payload(json: String?): JSONObject =
        json?.takeIf { it.isNotBlank() }
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?: JSONObject()
}
