package me.uwen.orahako.nativebridge.capabilities.background

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import com.dokar.quickjs.binding.define
import com.dokar.quickjs.quickJs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import me.uwen.orahako.nativebridge.NativeHostApp
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttp
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

enum class BackgroundExecutionOutcome {
    SUCCESS,
    RETRY,
    SKIPPED,
}

/**
 * Host primitives exposed to a headless QuickJS background task.
 * Abstracted behind an interface so JVM unit tests can execute real QuickJS
 * scripts with deterministic fake HTTP / storage / notification backends.
 */
interface BackgroundHostBridge {
    suspend fun httpSend(requestJson: String): String
    suspend fun storageGet(key: String): String?
    suspend fun storageSet(key: String, value: String)
    suspend fun storageRemove(key: String)
    suspend fun ensureNotificationChannel(specJson: String): Boolean
    suspend fun postNotification(specJson: String): String
    suspend fun cancelNotification(targetJson: String): Int
    suspend fun saveDiagnostics(diagnosticsJson: String)
    fun log(level: String, message: String)
}

/**
 * Isolated QuickJS (`quickjs-ng`) runner for plugin background tasks.
 *
 * Each execution spins up a brand-new QuickJS runtime with a memory cap and
 * hard coroutine timeout, injects a minimal Web/ECMAScript prelude plus
 * plugin-scoped host primitives, runs the registered task function, and tears
 * down the runtime immediately afterwards.
 */
object BackgroundJsRuntime {

    const val DEFAULT_MEMORY_LIMIT_BYTES: Long = 32L * 1024L * 1024L
    const val DEFAULT_TIMEOUT_MS: Long = 30_000L
    const val MAX_TIMEOUT_MS: Long = 90_000L

    private val PRELUDE_JS = """
        (function (global) {
          function formatArg(v) {
            if (typeof v === 'string') return v;
            if (v === undefined) return 'undefined';
            if (v === null) return 'null';
            if (v instanceof Error) return v.stack || (v.name + ': ' + v.message);
            try { return JSON.stringify(v); } catch (_) { return String(v); }
          }
          global.console = {
            log: function () { __orahakoNative.log('d', Array.prototype.map.call(arguments, formatArg).join(' ')); },
            info: function () { __orahakoNative.log('i', Array.prototype.map.call(arguments, formatArg).join(' ')); },
            warn: function () { __orahakoNative.log('w', Array.prototype.map.call(arguments, formatArg).join(' ')); },
            error: function () { __orahakoNative.log('e', Array.prototype.map.call(arguments, formatArg).join(' ')); }
          };

          var b64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
          global.btoa = function (input) {
            var str = String(input);
            var out = '';
            for (var i = 0; i < str.length; i += 3) {
              var a = str.charCodeAt(i) & 0xff;
              var b = i + 1 < str.length ? str.charCodeAt(i + 1) & 0xff : NaN;
              var c = i + 2 < str.length ? str.charCodeAt(i + 2) & 0xff : NaN;
              var enc1 = a >> 2;
              var enc2 = ((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4);
              var enc3 = isNaN(b) ? 64 : ((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6);
              var enc4 = isNaN(c) ? 64 : (c & 63);
              out += b64Chars.charAt(enc1) + b64Chars.charAt(enc2) + b64Chars.charAt(enc3) + b64Chars.charAt(enc4);
            }
            return out;
          };
          global.atob = function (input) {
            var str = String(input).replace(/[\t\n\f\r ]+/g, '');
            var out = '';
            for (var i = 0; i < str.length; i += 4) {
              var enc1 = b64Chars.indexOf(str.charAt(i));
              var enc2 = b64Chars.indexOf(str.charAt(i + 1));
              var enc3 = b64Chars.indexOf(str.charAt(i + 2));
              var enc4 = b64Chars.indexOf(str.charAt(i + 3));
              var chr1 = (enc1 << 2) | (enc2 >> 4);
              var chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
              var chr3 = ((enc3 & 3) << 6) | enc4;
              out += String.fromCharCode(chr1);
              if (enc3 !== 64 && enc3 !== -1) out += String.fromCharCode(chr2);
              if (enc4 !== 64 && enc4 !== -1) out += String.fromCharCode(chr3);
            }
            return out;
          };

          global.TextEncoder = function TextEncoder() {};
          global.TextEncoder.prototype.encode = function (str) {
            var s = String(str);
            var bytes = [];
            for (var i = 0; i < s.length; i++) {
              var cp = s.charCodeAt(i);
              if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
                var low = s.charCodeAt(++i);
                cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
              }
              if (cp < 0x80) bytes.push(cp);
              else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
              else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
              else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
            }
            return new Uint8Array(bytes);
          };

          global.TextDecoder = function TextDecoder() {};
          global.TextDecoder.prototype.decode = function (bytes) {
            if (!bytes) return '';
            var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            var out = '';
            for (var i = 0; i < arr.length; ) {
              var b0 = arr[i++];
              if (b0 < 0x80) out += String.fromCharCode(b0);
              else if ((b0 & 0xe0) === 0xc0) out += String.fromCharCode(((b0 & 0x1f) << 6) | (arr[i++] & 0x3f));
              else if ((b0 & 0xf0) === 0xe0) out += String.fromCharCode(((b0 & 0x0f) << 12) | ((arr[i++] & 0x3f) << 6) | (arr[i++] & 0x3f));
              else {
                var cp = ((b0 & 0x07) << 18) | ((arr[i++] & 0x3f) << 12) | ((arr[i++] & 0x3f) << 6) | (arr[i++] & 0x3f);
                cp -= 0x10000;
                out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
              }
            }
            return out;
          };

          global.URLSearchParams = function URLSearchParams(init) {
            this._pairs = [];
            if (typeof init === 'string') {
              var raw = init.charAt(0) === '?' ? init.slice(1) : init;
              if (raw) {
                var parts = raw.split('&');
                for (var i = 0; i < parts.length; i++) {
                  var eq = parts[i].indexOf('=');
                  var k = eq >= 0 ? parts[i].slice(0, eq) : parts[i];
                  var v = eq >= 0 ? parts[i].slice(eq + 1) : '';
                  this._pairs.push([decodeURIComponent(k.replace(/\+/g, ' ')), decodeURIComponent(v.replace(/\+/g, ' '))]);
                }
              }
            } else if (init && typeof init === 'object') {
              var keys = Object.keys(init);
              for (var j = 0; j < keys.length; j++) {
                this._pairs.push([keys[j], String(init[keys[j]])]);
              }
            }
          };
          global.URLSearchParams.prototype.append = function (k, v) { this._pairs.push([String(k), String(v)]); };
          global.URLSearchParams.prototype.set = function (k, v) {
            var key = String(k);
            this._pairs = this._pairs.filter(function (p) { return p[0] !== key; });
            this._pairs.push([key, String(v)]);
          };
          global.URLSearchParams.prototype.toString = function () {
            return this._pairs.map(function (p) {
              return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]);
            }).join('&');
          };

          var timers = Object.create(null);
          var nextTimerId = 1;
          global.setTimeout = function (fn, ms) {
            var id = nextTimerId++;
            timers[id] = true;
            __orahakoNative.sleep(Math.max(0, Number(ms) || 0)).then(function () {
              if (timers[id]) {
                delete timers[id];
                fn();
              }
            });
            return id;
          };
          global.clearTimeout = function (id) { delete timers[id]; };
        })(globalThis);
    """.trimIndent()

    private fun buildContextBootstrapJs(pluginId: String, taskId: String): String = """
        const __orahakoCtx = Object.freeze({
          pluginId: ${JSONObject.quote(pluginId)},
          taskId: ${JSONObject.quote(taskId)},
          http: Object.freeze({
            async send(req) {
              const raw = await __orahakoNative.httpSend(JSON.stringify(req || {}));
              return JSON.parse(raw);
            }
          }),
          storage: Object.freeze({
            async getItem(key) {
              const val = await __orahakoNative.storageGet(String(key));
              return val === undefined ? null : val;
            },
            async setItem(key, value) {
              await __orahakoNative.storageSet(String(key), String(value));
            },
            async removeItem(key) {
              await __orahakoNative.storageRemove(String(key));
            }
          }),
          notifications: Object.freeze({
            async ensureChannel(spec) {
              return Boolean(await __orahakoNative.ensureChannel(JSON.stringify(spec || {})));
            },
            async post(spec) {
              const raw = await __orahakoNative.postNotification(JSON.stringify(spec || {}));
              return JSON.parse(raw);
            },
            async cancel(target) {
              return Number(await __orahakoNative.cancelNotification(JSON.stringify(target || {}))) || 0;
            }
          }),
          state: Object.freeze({
            async setDiagnostics(snapshot) {
              await __orahakoNative.saveDiagnostics(JSON.stringify(snapshot || {}));
            }
          })
        });
    """.trimIndent()

    suspend fun execute(
        pluginId: String,
        taskId: String,
        script: String,
        payloadJson: String,
        bridge: BackgroundHostBridge,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS,
        memoryLimitBytes: Long = DEFAULT_MEMORY_LIMIT_BYTES,
    ): BackgroundExecutionOutcome {
        val boundedTimeout = timeoutMs.coerceIn(1_000L, MAX_TIMEOUT_MS)
        return withTimeout(boundedTimeout) {
            quickJs {
                memoryLimit = memoryLimitBytes

                define("__orahakoNative") {
                    function("log") { args ->
                        val level = args.getOrNull(0)?.toString() ?: "d"
                        val message = args.getOrNull(1)?.toString() ?: ""
                        bridge.log(level, message)
                        null
                    }
                    asyncFunction<Any?>("sleep") { args ->
                        val ms = (args.getOrNull(0) as? Number)?.toLong()?.coerceIn(0L, boundedTimeout) ?: 0L
                        delay(ms)
                        null
                    }
                    asyncFunction<String>("httpSend") { args ->
                        val reqJson = args.getOrNull(0)?.toString() ?: "{}"
                        bridge.httpSend(reqJson)
                    }
                    asyncFunction<String?>("storageGet") { args ->
                        val key = args.getOrNull(0)?.toString() ?: ""
                        bridge.storageGet(key)
                    }
                    asyncFunction<Any?>("storageSet") { args ->
                        val key = args.getOrNull(0)?.toString() ?: ""
                        val value = args.getOrNull(1)?.toString() ?: ""
                        bridge.storageSet(key, value)
                        null
                    }
                    asyncFunction<Any?>("storageRemove") { args ->
                        val key = args.getOrNull(0)?.toString() ?: ""
                        bridge.storageRemove(key)
                        null
                    }
                    asyncFunction<Boolean>("ensureChannel") { args ->
                        val specJson = args.getOrNull(0)?.toString() ?: "{}"
                        bridge.ensureNotificationChannel(specJson)
                    }
                    asyncFunction<String>("postNotification") { args ->
                        val specJson = args.getOrNull(0)?.toString() ?: "{}"
                        bridge.postNotification(specJson)
                    }
                    asyncFunction<Int>("cancelNotification") { args ->
                        val targetJson = args.getOrNull(0)?.toString() ?: "{}"
                        bridge.cancelNotification(targetJson)
                    }
                    asyncFunction<Any?>("saveDiagnostics") { args ->
                        val diagJson = args.getOrNull(0)?.toString() ?: "{}"
                        bridge.saveDiagnostics(diagJson)
                        null
                    }
                }

                evaluate<Any?>(PRELUDE_JS)
                evaluate<Any?>(script)
                val runner = """
                    ${buildContextBootstrapJs(pluginId, taskId)}
                    const __orahakoPayload = JSON.parse(${JSONObject.quote(payloadJson)});
                    const __orahakoFn = globalThis.__orahakoBackgroundTask;
                    if (typeof __orahakoFn !== 'function') {
                      throw new Error('Background script did not register globalThis.__orahakoBackgroundTask');
                    }
                    const __orahakoOutcome = await __orahakoFn(__orahakoCtx, __orahakoPayload);
                    typeof __orahakoOutcome === 'string' ? __orahakoOutcome : 'success';
                """.trimIndent()
                val outcome = evaluate<String>(runner)
                when (outcome.lowercase()) {
                    "retry" -> BackgroundExecutionOutcome.RETRY
                    "skipped" -> BackgroundExecutionOutcome.SKIPPED
                    else -> BackgroundExecutionOutcome.SUCCESS
                }
            }
        }
    }
}

/**
 * Production Android implementation of [BackgroundHostBridge]:
 * - OkHttp without implicit redirect/cookie magic (so JS CookieJar has full control)
 * - Per-plugin SharedPreferences storage (`orahako_bg_storage_<pluginId>`)
 * - Direct Android NotificationManager channel creation, posting & cancellation
 */
class AndroidBackgroundHostBridge(
    private val context: Context,
    private val pluginId: String,
    private val onDiagnostics: (String) -> Unit,
) : BackgroundHostBridge {

    companion object {
        private const val TAG = "OrahakoBgJs"
        private val nextNotificationId = AtomicInteger(60_000)

        fun storagePrefsName(pluginId: String): String {
            val safe = pluginId.replace(Regex("[^A-Za-z0-9._-]"), "_")
            return "orahako_bg_storage_$safe"
        }

        fun clearPluginStorage(context: Context, pluginId: String) {
            context.applicationContext
                .getSharedPreferences(storagePrefsName(pluginId), Context.MODE_PRIVATE)
                .edit()
                .clear()
                .apply()
        }
    }

    private val appContext = context.applicationContext
    private val prefs by lazy {
        appContext.getSharedPreferences(storagePrefsName(pluginId), Context.MODE_PRIVATE)
    }

    private val userAgent: String by lazy {
        val version = NativeHostApp.versionName(appContext)
        if (version.isEmpty()) "okhttp/${OkHttp.VERSION} orahako"
        else "okhttp/${OkHttp.VERSION} orahako/$version"
    }

    private val baseClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }

    override suspend fun httpSend(requestJson: String): String = withContext(Dispatchers.IO) {
        val reqObj = JSONObject(requestJson)
        val url = reqObj.optString("url", "").trim()
        require(url.isNotEmpty()) { "http.send requires a non-empty url" }
        val method = reqObj.optString("method", "GET").uppercase()
        val followRedirects = reqObj.optBoolean("followRedirects", false)
        val timeoutMs = reqObj.optLong("timeoutMs", 20_000L).coerceIn(1_000L, 60_000L)
        val responseType = reqObj.optString("responseType", "text")

        val client = if (followRedirects || timeoutMs != 20_000L) {
            baseClient.newBuilder()
                .followRedirects(followRedirects)
                .followSslRedirects(followRedirects)
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build()
        } else {
            baseClient
        }

        val builder = Request.Builder().url(url)
        var hasUserAgent = false
        var contentType: String? = null
        val headersObj = reqObj.optJSONObject("headers")
        if (headersObj != null) {
            val keys = headersObj.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = headersObj.optString(key, "")
                if (key.equals("User-Agent", ignoreCase = true)) hasUserAgent = true
                if (key.equals("Content-Type", ignoreCase = true)) contentType = value
                builder.header(key, value)
            }
        }
        if (!hasUserAgent) {
            builder.header("User-Agent", userAgent)
        }

        val hasBody = reqObj.has("body") && !reqObj.isNull("body")
        if (method == "GET" || method == "HEAD") {
            builder.method(method, null)
        } else {
            val bodyString = if (hasBody) reqObj.optString("body", "") else ""
            val mediaType = (contentType ?: "application/x-www-form-urlencoded; charset=UTF-8").toMediaTypeOrNull()
            builder.method(method, bodyString.toRequestBody(mediaType))
        }

        client.newCall(builder.build()).execute().use { response ->
            val headersJson = JSONObject()
            val setCookies = JSONArray()
            for (i in 0 until response.headers.size) {
                val name = response.headers.name(i)
                val value = response.headers.value(i)
                if (name.equals("Set-Cookie", ignoreCase = true)) {
                    setCookies.put(value)
                }
                val lower = name.lowercase()
                if (headersJson.has(lower)) {
                    headersJson.put(lower, "${headersJson.getString(lower)}, $value")
                } else {
                    headersJson.put(lower, value)
                }
            }
            val rawBytes = response.body?.bytes() ?: ByteArray(0)
            val bodyOut = if (responseType == "base64") {
                Base64.encodeToString(rawBytes, Base64.NO_WRAP)
            } else {
                rawBytes.toString(Charsets.UTF_8)
            }
            JSONObject()
                .put("status", response.code)
                .put("url", response.request.url.toString())
                .put("headers", headersJson)
                .put("setCookies", setCookies)
                .put("body", bodyOut)
                .toString()
        }
    }

    override suspend fun storageGet(key: String): String? = withContext(Dispatchers.IO) {
        if (prefs.contains(key)) prefs.getString(key, null) else null
    }

    override suspend fun storageSet(key: String, value: String) = withContext(Dispatchers.IO) {
        prefs.edit().putString(key, value).apply()
    }

    override suspend fun storageRemove(key: String) = withContext(Dispatchers.IO) {
        prefs.edit().remove(key).apply()
    }

    override suspend fun ensureNotificationChannel(specJson: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        val spec = JSONObject(specJson)
        val id = spec.optString("id", "").trim()
        val name = spec.optString("name", "").trim()
        if (id.isEmpty() || name.isEmpty()) return false
        val manager = appContext.getSystemService(NotificationManager::class.java) ?: return false
        val created = manager.getNotificationChannel(id) == null
        val importance = when (spec.optString("importance", "default").lowercase()) {
            "none", "min" -> NotificationManager.IMPORTANCE_MIN
            "low" -> NotificationManager.IMPORTANCE_LOW
            "high" -> NotificationManager.IMPORTANCE_HIGH
            "max" -> NotificationManager.IMPORTANCE_MAX
            else -> NotificationManager.IMPORTANCE_DEFAULT
        }
        val sound = spec.optBoolean("sound", true)
        val vibration = spec.optBoolean("vibration", true)
        val showBadge = spec.optBoolean("showBadge", true)
        val visibility = when (spec.optString("lockscreenVisibility", "").lowercase()) {
            "public" -> Notification.VISIBILITY_PUBLIC
            "private" -> Notification.VISIBILITY_PRIVATE
            "secret" -> Notification.VISIBILITY_SECRET
            else -> if (importance >= NotificationManager.IMPORTANCE_HIGH) Notification.VISIBILITY_PUBLIC else null
        }

        val channel = NotificationChannel(id, name, importance).apply {
            description = spec.optString("description", "")
            enableVibration(vibration)
            setShowBadge(showBadge)
            if (visibility != null) lockscreenVisibility = visibility
            if (sound) {
                setSound(
                    Settings.System.DEFAULT_NOTIFICATION_URI,
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
            } else {
                setSound(null, null)
            }
        }
        manager.createNotificationChannel(channel)
        return created
    }

    override suspend fun postNotification(specJson: String): String {
        val spec = JSONObject(specJson)
        val channelId = spec.optString("channelId", "").trim()
        val title = spec.optString("title", "").trim()
        require(channelId.isNotEmpty() && title.isNotEmpty()) { "channelId and title are required" }
        val body = spec.optString("body", "")
        val bigText = spec.optString("bigText", "").takeIf { it.isNotEmpty() }
        val tag = spec.optString("tag", "").takeIf { it.isNotEmpty() }
        val id = if (spec.has("id") && !spec.isNull("id")) spec.optInt("id") else nextNotificationId.getAndIncrement()
        val silent = spec.optBoolean("silent", false)
        val autoCancel = spec.optBoolean("autoCancel", true)
        val onlyAlertOnce = spec.optBoolean("onlyAlertOnce", false)
        val deepLinkUri = spec.optString("deepLink", "").takeIf { it.isNotEmpty() }
            ?.let { runCatching { Uri.parse(it) }.getOrNull() }
        val priority = when (spec.optString("priority", "high").lowercase()) {
            "min" -> NotificationCompat.PRIORITY_MIN
            "low" -> NotificationCompat.PRIORITY_LOW
            "default" -> NotificationCompat.PRIORITY_DEFAULT
            "max" -> NotificationCompat.PRIORITY_MAX
            else -> NotificationCompat.PRIORITY_HIGH
        }
        val category = when (spec.optString("category", "status").lowercase()) {
            "reminder" -> NotificationCompat.CATEGORY_REMINDER
            "event" -> NotificationCompat.CATEGORY_EVENT
            "alarm" -> NotificationCompat.CATEGORY_ALARM
            "error" -> NotificationCompat.CATEGORY_ERROR
            "message" -> NotificationCompat.CATEGORY_MESSAGE
            else -> NotificationCompat.CATEGORY_STATUS
        }

        val builder = NotificationCompat.Builder(appContext, channelId)
            .setSmallIcon(
                if (category == NotificationCompat.CATEGORY_ERROR) android.R.drawable.ic_dialog_alert
                else android.R.drawable.ic_dialog_info,
            )
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(
                NativeHostApp.activityPendingIntent(
                    appContext,
                    requestCode = id,
                    deepLink = deepLinkUri,
                ),
            )
            .setAutoCancel(autoCancel)
            .setOnlyAlertOnce(onlyAlertOnce)
            .setPriority(priority)
            .setCategory(category)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(
                if (silent) 0
                else NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE,
            )
        if (bigText != null) {
            builder.setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
        }

        val manager = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (tag != null) manager.notify(tag, id, builder.build())
        else manager.notify(id, builder.build())

        return JSONObject()
            .put("id", id)
            .put("tag", tag ?: JSONObject.NULL)
            .put("posted", true)
            .toString()
    }

    override suspend fun cancelNotification(targetJson: String): Int {
        val target = JSONObject(targetJson)
        val manager = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (target.has("id") && !target.isNull("id")) {
            val id = target.optInt("id")
            val tag = target.optString("tag", "").takeIf { it.isNotEmpty() }
            if (tag != null) manager.cancel(tag, id) else manager.cancel(id)
            return 1
        }
        val channelId = target.optString("channelId", "").takeIf { it.isNotEmpty() } ?: return 0
        var count = 0
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            for (active in manager.activeNotifications) {
                if (active.notification.channelId == channelId) {
                    if (active.tag != null) manager.cancel(active.tag, active.id)
                    else manager.cancel(active.id)
                    count += 1
                }
            }
        }
        return count
    }

    override suspend fun saveDiagnostics(diagnosticsJson: String) {
        onDiagnostics(diagnosticsJson)
    }

    override fun log(level: String, message: String) {
        val prefixed = "[$pluginId] $message"
        when (level) {
            "e" -> Log.e(TAG, prefixed)
            "w" -> Log.w(TAG, prefixed)
            "i" -> Log.i(TAG, prefixed)
            else -> Log.d(TAG, prefixed)
        }
    }
}
