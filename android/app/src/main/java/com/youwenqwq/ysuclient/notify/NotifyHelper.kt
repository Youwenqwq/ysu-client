package com.youwenqwq.ysuclient.notify

import android.content.Context
import android.util.Log
import com.youwenqwq.ysuclient.BuildConfig
import com.youwenqwq.ysuclient.cache.UnifiedCache
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttp
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import java.net.URLEncoder
import java.math.BigDecimal
import java.util.concurrent.TimeUnit

/**
 * 通知模块核心逻辑：HTTP 请求、Cookie 管理、Diff、缓存。
 *
 * 使用 OkHttp 发起 HTTP 请求，Cookie 存储与主程序的 java.net.CookieManager
 * 和 android.webkit.CookieManager 完全隔离，互不干扰。
 *
 * 每次 Worker 运行时都使用 CASTGC 重新建立 JWXT 会话，不依赖持久化的 session cookies。
 * 学校配置从 UnifiedCache 读取，支持 JS 端动态下发。
 */
data class Quadruple<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)

sealed class FetchResult {
    data class Success(val items: List<JSONObject>) : FetchResult()
    data class Failure(val error: Exception? = null, val message: String? = null) : FetchResult()
}

class NotifySessionExpiredException(message: String) : Exception(message)

class NotifyProtocolException(message: String, cause: Throwable? = null) : Exception(message, cause)

object NotifyHelper {
    private const val TAG = "YsuNotify"
    const val NOTIFY_SCHEMA_VERSION = 2
    private val gradeAttemptFields = listOf("class_id", "exam_type", "study_mode", "is_retake")
    private val gradeResultFields = listOf("score", "grade_level", "grade_point", "is_pass")
    private val htmlTag = Regex("""<\s*(?:!doctype|html|head|body|form|input|script)\b""", RegexOption.IGNORE_CASE)
    private val loginMarker = Regex(
        """authserver/login|reAuthCheck|isMultifactor|reAuthType|二次认证|<input\b[^>]*\btype\s*=\s*["']?password\b""",
        RegexOption.IGNORE_CASE
    )

    // ─── OkHttp client with isolated cookie jar ──────────────────────────────

    private val cookieStore = mutableMapOf<String, MutableList<Cookie>>()

    private val cookieJar = object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            for (cookie in cookies) {
                val key = "${cookie.domain}|${cookie.path}"
                val list = cookieStore.getOrPut(key) { mutableListOf() }
                list.removeAll { it.name == cookie.name }
                if (!cookie.hasExpired()) {
                    list.add(cookie)
                    Log.d(TAG, "Cookie saved: ${cookie.name} domain=${cookie.domain} path=${cookie.path}")
                }
            }
        }

        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            val result = mutableListOf<Cookie>()
            for (list in cookieStore.values) {
                for (cookie in list) {
                    if (!cookie.hasExpired() && cookie.matches(url)) {
                        result.add(cookie)
                    }
                }
            }
            return result
        }
    }

    private fun Cookie.hasExpired(): Boolean = expiresAt < System.currentTimeMillis()

    private fun valueOrNull(value: Any?): Any? =
        value?.takeUnless { it == JSONObject.NULL || (it is String && it.isBlank()) }

    private fun JSONObject.text(key: String): String =
        when (val value = valueOrNull(opt(key))) {
            null -> ""
            is Number -> BigDecimal(value.toString()).stripTrailingZeros().toPlainString()
            else -> value.toString()
        }

    private fun firstValue(raw: JSONObject, keys: List<String>): Any? {
        for (key in keys) {
            valueOrNull(raw.opt(key))?.let { return it }
        }
        return null
    }

    private fun cleanText(value: String): String {
        return value
            .replace(Regex("<[^>]*>"), "")
            .replace(Regex("&nbsp;", RegexOption.IGNORE_CASE), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun normalizeDate(value: String): String {
        val match = Regex("""(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})""").find(cleanText(value)) ?: return ""
        return "%04d-%02d-%02d".format(
            match.groupValues[1].toInt(),
            match.groupValues[2].toInt(),
            match.groupValues[3].toInt()
        )
    }

    private fun normalizeTime(value: String): String {
        val match = Regex("""(\d{1,2}):(\d{2})""").find(cleanText(value)) ?: return ""
        val hour = match.groupValues[1].toIntOrNull() ?: return ""
        val minute = match.groupValues[2].toIntOrNull() ?: return ""
        if (hour !in 0..23 || minute !in 0..59) return ""
        return "%02d:%02d".format(hour, minute)
    }

    private fun combineLocalDateTime(date: String, time: String): String {
        return if (date.isNotEmpty() && time.isNotEmpty()) "${date}T${time}:00" else ""
    }

    private fun putExamDateTimes(standard: JSONObject, raw: JSONObject) {
        val date = normalizeDate(raw.text("KSRQ"))
        val displayText = cleanText(raw.text("KSSJMS"))
        val displayTimes = Regex("""\d{1,2}:\d{2}""").findAll(displayText)
            .map { normalizeTime(it.value) }
            .filter { it.isNotEmpty() }
            .toList()
        val startTime = normalizeTime(raw.text("KSSJ")).ifEmpty { displayTimes.getOrNull(0) ?: "" }
        val endTime = normalizeTime(raw.text("JSSJ")).ifEmpty { displayTimes.getOrNull(1) ?: "" }
        val timeText = displayText.ifEmpty {
            when {
                startTime.isNotEmpty() && endTime.isNotEmpty() -> "$startTime-$endTime"
                startTime.isNotEmpty() -> startTime
                else -> endTime
            }
        }
        val startAt = combineLocalDateTime(date, startTime)
        val endAt = combineLocalDateTime(date, endTime)
        if (startAt.isNotEmpty()) standard.put("start_at", startAt)
        if (endAt.isNotEmpty()) standard.put("end_at", endAt)
        if (timeText.isNotEmpty()) standard.put("time_text", timeText)
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .cookieJar(cookieJar)
        .addInterceptor { chain ->
            val req = chain.request()
            val newReq = req.newBuilder()
                .header("User-Agent", "okhttp/${OkHttp.VERSION} ysu-client/${BuildConfig.VERSION_NAME}")
                .build()
            chain.proceed(newReq)
        }
        .build()

    // ─── Config helpers ─────────────────────────────────────────────────────

    fun getServerConfig(context: Context): JSONObject? {
        return UnifiedCache.getJsonObject(context, UnifiedCache.KEY_SERVER_CONFIG)
    }

    fun getConfigString(config: JSONObject?, path: String, fallback: String): String {
        if (config == null) return fallback
        val parts = path.split(".")
        var current: Any? = config
        for (part in parts) {
            current = when (current) {
                is JSONObject -> current.opt(part)
                else -> return fallback
            }
        }
        return when (current) {
            is String -> current
            is Number -> current.toString()
            else -> fallback
        }
    }

    fun getConfigArray(config: JSONObject?, path: String): List<String> {
        if (config == null) return emptyList()
        val parts = path.split(".")
        var current: Any? = config
        for (part in parts) {
            current = when (current) {
                is JSONObject -> current.opt(part)
                else -> return emptyList()
            }
        }
        return when (current) {
            is JSONArray -> (0 until current.length()).map { current.optString(it, "") }.filter { it.isNotEmpty() }
            else -> emptyList()
        }
    }

    fun getCerBase(context: Context): String {
        val config = getServerConfig(context)
        return getConfigString(config, "cerBaseUrl", "https://cer.ysu.edu.cn")
    }

    fun getJwxtBase(context: Context): String {
        val config = getServerConfig(context)
        return getConfigString(config, "jwxtBaseUrl", "https://jwxt.ysu.edu.cn")
    }

    fun getPortalUrl(context: Context): String {
        return "${getJwxtBase(context)}/jwapp/sys/emaphome/portal/index.do"
    }

    fun getAppBase(context: Context): String {
        return "${getJwxtBase(context)}/jwapp/sys"
    }

    fun getAppId(context: Context, key: String): String {
        val config = getServerConfig(context)
        return getConfigString(config, "apiPaths.$key.appId", "")
    }

    fun getApiPath(context: Context, key: String): String {
        val config = getServerConfig(context)
        return getConfigString(config, "apiPaths.$key.path", "")
    }

    // ─── UnifiedCache wrappers ──────────────────────────────────────────────

    fun saveCastgc(context: Context, castgc: String) {
        UnifiedCache.putString(context, UnifiedCache.KEY_CASTGC, castgc)
    }

    fun getCastgc(context: Context): String? {
        val value = UnifiedCache.getString(context, UnifiedCache.KEY_CASTGC, "")
        return if (value.isEmpty()) null else value
    }

    fun clearCastgc(context: Context) {
        UnifiedCache.remove(context, UnifiedCache.KEY_CASTGC)
    }

    fun saveSettings(context: Context, interval: Int, grades: Boolean, exams: Boolean, notifyNetworkError: Boolean) {
        val obj = JSONObject().apply {
            put("interval", interval)
            put("grades", grades)
            put("exams", exams)
            put("notifyNetworkError", notifyNetworkError)
        }
        UnifiedCache.putJsonObject(context, UnifiedCache.KEY_NOTIFY_SETTINGS, obj)
    }

    fun getSettings(context: Context): Triple<Int, Boolean, Boolean> {
        val obj = UnifiedCache.getJsonObject(context, UnifiedCache.KEY_NOTIFY_SETTINGS)
        return if (obj != null) {
            Triple(
                obj.optInt("interval", 60),
                obj.optBoolean("grades", true),
                obj.optBoolean("exams", true)
            )
        } else {
            Triple(60, true, true)
        }
    }

    fun getSettingsWithNetworkError(context: Context): Quadruple<Int, Boolean, Boolean, Boolean> {
        val obj = UnifiedCache.getJsonObject(context, UnifiedCache.KEY_NOTIFY_SETTINGS)
        return if (obj != null) {
            Quadruple(
                obj.optInt("interval", 60),
                obj.optBoolean("grades", true),
                obj.optBoolean("exams", true),
                obj.optBoolean("notifyNetworkError", false)
            )
        } else {
            Quadruple(60, true, true, false)
        }
    }

    fun saveProviderIdentity(context: Context, providerId: String, accountHash: String) {
        val oldProviderId = UnifiedCache.getString(context, UnifiedCache.KEY_NOTIFY_PROVIDER_ID, "")
        val oldAccountHash = UnifiedCache.getString(context, UnifiedCache.KEY_NOTIFY_ACCOUNT_HASH, "")
        val oldSchemaVersion = UnifiedCache.getInt(context, UnifiedCache.KEY_NOTIFY_SCHEMA_VERSION, 0)

        if (oldSchemaVersion != NOTIFY_SCHEMA_VERSION || oldProviderId != providerId || oldAccountHash != accountHash) {
            Log.d(TAG, "Notify identity changed; resetting baselines")
            resetBaselines(context)
        }

        UnifiedCache.putString(context, UnifiedCache.KEY_NOTIFY_PROVIDER_ID, providerId)
        UnifiedCache.putString(context, UnifiedCache.KEY_NOTIFY_ACCOUNT_HASH, accountHash)
        UnifiedCache.putInt(context, UnifiedCache.KEY_NOTIFY_SCHEMA_VERSION, NOTIFY_SCHEMA_VERSION)
    }

    fun ensureBaselineIdentity(context: Context): Boolean {
        val schemaVersion = UnifiedCache.getInt(context, UnifiedCache.KEY_NOTIFY_SCHEMA_VERSION, 0)
        val providerId = UnifiedCache.getString(context, UnifiedCache.KEY_NOTIFY_PROVIDER_ID, "")
        val accountHash = UnifiedCache.getString(context, UnifiedCache.KEY_NOTIFY_ACCOUNT_HASH, "")
        if (schemaVersion == NOTIFY_SCHEMA_VERSION && providerId.isNotEmpty() && accountHash.isNotEmpty()) {
            return true
        }

        Log.w(TAG, "Notify baseline identity missing or outdated; resetting baselines")
        resetBaselines(context)
        return false
    }

    fun resetBaselines(context: Context) {
        UnifiedCache.remove(context, UnifiedCache.KEY_NOTIFY_CACHED_GRADES)
        UnifiedCache.remove(context, UnifiedCache.KEY_NOTIFY_CACHED_EXAMS)
        UnifiedCache.putBoolean(context, UnifiedCache.KEY_NOTIFY_GRADES_BASELINE_INITIALIZED, false)
        UnifiedCache.putBoolean(context, UnifiedCache.KEY_NOTIFY_EXAMS_BASELINE_INITIALIZED, false)
    }

    fun isGradesBaselineInitialized(context: Context): Boolean {
        return UnifiedCache.getBoolean(context, UnifiedCache.KEY_NOTIFY_GRADES_BASELINE_INITIALIZED, false)
    }

    fun isExamsBaselineInitialized(context: Context): Boolean {
        return UnifiedCache.getBoolean(context, UnifiedCache.KEY_NOTIFY_EXAMS_BASELINE_INITIALIZED, false)
    }

    fun setGradesBaselineInitialized(context: Context, initialized: Boolean) {
        UnifiedCache.putBoolean(context, UnifiedCache.KEY_NOTIFY_GRADES_BASELINE_INITIALIZED, initialized)
    }

    fun setExamsBaselineInitialized(context: Context, initialized: Boolean) {
        UnifiedCache.putBoolean(context, UnifiedCache.KEY_NOTIFY_EXAMS_BASELINE_INITIALIZED, initialized)
    }

    fun setSessionExpired(context: Context, expired: Boolean) {
        UnifiedCache.putBoolean(context, "session_expired", expired)
    }

    fun isSessionExpired(context: Context): Boolean {
        return UnifiedCache.getBoolean(context, "session_expired", false)
    }

    // ─── Cookie helpers ─────────────────────────────────────────────────────

    private fun hasSessionCookie(url: HttpUrl): Boolean =
        cookieJar.loadForRequest(url).any {
            (it.name == "GS_SESSIONID" || it.name == "JSESSIONID") && it.value.isNotEmpty()
        }

    // ─── HTTP helpers ───────────────────────────────────────────────────────

    private fun buildGet(url: String): Request = Request.Builder()
        .url(url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .build()

    internal data class HttpResult(
        val code: Int,
        val body: String,
        val finalUrl: String,
        val location: String? = null
    )

    /** 单次 GET，不跟随重定向。 */
    private fun httpGet(url: String): HttpResult {
        client.newCall(buildGet(url)).execute().use { resp ->
            val body = resp.body?.string() ?: ""
            val u = resp.request.url
            Log.d(TAG, "httpGet: code=${resp.code}, host=${u.host}, path=${u.encodedPath}")
            return HttpResult(resp.code, body, resp.request.url.toString(), resp.header("Location"))
        }
    }

    private fun httpPost(url: String, data: String): HttpResult {
        val body = object : RequestBody() {
            override fun contentType() = "application/x-www-form-urlencoded; charset=UTF-8".toMediaType()
            override fun writeTo(sink: BufferedSink) {
                sink.writeUtf8(data)
            }
        }

        val request = Request.Builder()
            .url(url)
            .post(body)
            .header("X-Requested-With", "XMLHttpRequest")
            .header("Accept", "application/json, text/javascript, */*; q=0.01")
            .build()

        client.newCall(request).execute().use { resp ->
            return HttpResult(resp.code, resp.body?.string() ?: "", resp.request.url.toString(), resp.header("Location"))
        }
    }

    // ─── JWXT session establishment ─────────────────────────────────────────

    private fun isRedirect(code: Int): Boolean = code == 301 || code == 302 || code == 303 || code == 307 || code == 308

    private fun sameOrigin(left: HttpUrl, right: HttpUrl): Boolean =
        left.scheme == right.scheme && left.host == right.host && left.port == right.port

    private fun isAuthLocation(url: HttpUrl): Boolean =
        url.encodedPath.contains("/authserver/login", ignoreCase = true) ||
            url.encodedPath.contains("reAuthCheck", ignoreCase = true) ||
            url.queryParameter("isMultifactor").equals("true", ignoreCase = true)

    private fun isLoginHtml(body: String): Boolean =
        htmlTag.containsMatchIn(body) && loginMarker.containsMatchIn(body)

    private fun checkStatus(result: HttpResult) {
        if (result.code == 401 || result.code == 403) {
            throw NotifySessionExpiredException("Authentication required: HTTP ${result.code}")
        }
        if (result.code != 200 && !isRedirect(result.code)) {
            throw NotifyProtocolException("Unexpected HTTP ${result.code}")
        }
    }

    private fun redirectTarget(result: HttpResult): HttpUrl {
        val location = result.location?.takeIf { it.isNotBlank() }
            ?: throw NotifyProtocolException("Redirect missing Location")
        return result.finalUrl.toHttpUrl().resolve(location)
            ?: throw NotifyProtocolException("Invalid redirect Location")
    }

    private fun requireJwxtDestination(url: HttpUrl, jwxt: HttpUrl, cas: HttpUrl) {
        if (!sameOrigin(url, jwxt) && !sameOrigin(url, cas)) {
            throw NotifyProtocolException("Untrusted redirect destination")
        }
        if (url.username.isNotEmpty() || url.password.isNotEmpty()) {
            throw NotifyProtocolException("Redirect contains user information")
        }
        if (isAuthLocation(url)) {
            throw NotifySessionExpiredException("Redirect requires CAS login or MFA")
        }
        if (!sameOrigin(url, jwxt) || !url.encodedPath.startsWith("/jwapp/")) {
            throw NotifyProtocolException("Redirect is not a JWXT application destination")
        }
    }

    internal fun sessionDestination(
        result: HttpResult,
        jwxt: HttpUrl,
        cas: HttpUrl,
        hasSession: Boolean,
        fromCas: Boolean
    ): HttpUrl {
        checkStatus(result)
        if (result.code == 200 && isLoginHtml(result.body)) {
            throw NotifySessionExpiredException("Session requires login or MFA")
        }
        if (fromCas && !isRedirect(result.code)) {
            throw NotifyProtocolException("CAS did not authorize the JWXT service")
        }
        val destination = if (isRedirect(result.code)) redirectTarget(result) else result.finalUrl.toHttpUrl()
        requireJwxtDestination(destination, jwxt, cas)
        if (!fromCas && !hasSession) {
            throw NotifyProtocolException("JWXT response did not establish a session cookie")
        }
        return destination
    }

    /**
     * Exchange CASTGC for a JWXT session without automatically following redirects.
     * Only confirmed authentication failures return false; transport and protocol errors propagate.
     */
    fun establishSession(context: Context, castgc: String): Boolean {
        try {
            cookieStore.clear()
            val cerBase = getCerBase(context).toHttpUrl()
            val jwxtBase = getJwxtBase(context).toHttpUrl()
            val castgcBuilder = Cookie.Builder()
                .hostOnlyDomain(cerBase.host)
                .path("/authserver")
                .name("CASTGC")
                .value(castgc)
            if (cerBase.isHttps) castgcBuilder.secure()
            cookieJar.saveFromResponse(cerBase, listOf(castgcBuilder.build()))

            val portalUrl = getPortalUrl(context)
            val service = URLEncoder.encode(portalUrl, "UTF-8")
            val casResponse = httpGet("${getCerBase(context)}/authserver/login?service=$service")
            val ticketUrl = sessionDestination(casResponse, jwxtBase, cerBase, false, true)
            val jwxtResponse = httpGet(ticketUrl.toString())
            sessionDestination(jwxtResponse, jwxtBase, cerBase, hasSessionCookie(portalUrl.toHttpUrl()), false)
            return true
        } catch (_: NotifySessionExpiredException) {
            return false
        } catch (e: IllegalArgumentException) {
            throw NotifyProtocolException("Invalid notification session configuration or request", e)
        }
    }

    // ─── WEU management ─────────────────────────────────────────────────────

    /** 访问 appShow.do 获取指定应用的 _WEU cookie。 */
    fun fetchWeu(context: Context, appId: String): String? {
        val jwxtBase = getJwxtBase(context)
        val url = "$jwxtBase/jwapp/sys/emaphome/appShow.do?id=$appId"
        val result = httpGet(url)
        Log.d(TAG, "appShow: appId=$appId, code=${result.code}, finalUrl=${result.finalUrl}")

        checkStatus(result)
        if (isRedirect(result.code)) {
            requireJwxtDestination(redirectTarget(result), jwxtBase.toHttpUrl(), getCerBase(context).toHttpUrl())
        } else if (isLoginHtml(result.body)) {
            throw NotifySessionExpiredException("Application entry requires login")
        }

        // appShow may set _WEU on a 302; do not follow the application redirect.
        val weu = cookieJar.loadForRequest(url.toHttpUrl()).firstOrNull { it.name == "_WEU" }?.value
        Log.d(TAG, "WEU for appId=$appId: ${weu != null}")
        return weu
    }

    // ─── Current term ───────────────────────────────────────────────────────

    fun getCurrentTerm(context: Context): String? {
        val appBase = getAppBase(context)
        val apiPath = getApiPath(context, "currentTerm")
        val rows = emapRows(
            httpPost("$appBase/$apiPath", ""),
            "dqxnxq",
            getJwxtBase(context).toHttpUrl(),
            getCerBase(context).toHttpUrl()
        )
        if (rows.length() == 0) throw NotifyProtocolException("Current term response has no rows")
        val term = rows.optJSONObject(0)?.text("DM")
        return term?.takeIf { it.isNotEmpty() }
            ?: throw NotifyProtocolException("Current term response has no term")
    }

    // ─── Format conversion ──────────────────────────────────────────────────

    /**
     * 从 mappings 中解析 raw key。JS 端可能发送字符串或字符串数组（优先候选列表）。
     */
    private fun resolveRawKeys(mappings: JSONObject, standardKey: String): List<String> {
        val value = mappings.opt(standardKey) ?: return listOf(standardKey)
        return when (value) {
            is JSONArray -> (0 until value.length()).mapNotNull {
                (value.opt(it) as? String)?.takeIf { key -> key.isNotBlank() }
            }
            is String -> listOf(value).filter { it.isNotBlank() }
            else -> listOf(standardKey)
        }
    }

    /**
     * 将原始成绩对象转换为标准格式，字段名由 server config 中的 fieldMappings 定义。
     */
    fun convertGradeToStandard(context: Context, raw: JSONObject): JSONObject {
        val config = getServerConfig(context)
        val mappings = config?.optJSONObject("fieldMappings")?.optJSONObject("grade") ?: JSONObject()
        return convertGradeToStandard(raw, mappings)
    }

    private fun mapFields(raw: JSONObject, mappings: JSONObject): JSONObject {
        val standard = JSONObject()
        val keys = mappings.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            firstValue(raw, resolveRawKeys(mappings, key))?.let { standard.put(key, it) }
        }
        return standard
    }

    private fun putFallback(standard: JSONObject, raw: JSONObject, key: String, vararg rawKeys: String) {
        if (valueOrNull(standard.opt(key)) == null) {
            firstValue(raw, rawKeys.asList())?.let { standard.put(key, it) }
        }
    }

    internal fun convertGradeToStandard(raw: JSONObject, mappings: JSONObject): JSONObject {
        val standard = mapFields(raw, mappings)
        putFallback(standard, raw, "course_name", "XSKCM", "KCM")
        putFallback(standard, raw, "course_code", "XSKCH", "KCH")
        putFallback(standard, raw, "record_id", "WID")
        putFallback(standard, raw, "class_id", "JXBID")
        putFallback(standard, raw, "score", "ZCJ", "XSZCJMC", "BFZCJ")
        putFallback(standard, raw, "grade_level", "XSZCJMC")
        putFallback(standard, raw, "grade_point", "XFJD")
        putFallback(standard, raw, "credit", "XF")
        putFallback(standard, raw, "term", "XNXQDM")
        putFallback(standard, raw, "exam_type", "KSLXDM_DISPLAY", "KSLXDM", "KSXS")
        putFallback(standard, raw, "study_mode", "XDFSDM_DISPLAY")
        putFallback(standard, raw, "is_retake", "CXCKDM_DISPLAY")
        return standard
    }

    /**
     * 将原始考试对象转换为标准格式，字段名由 server config 中的 fieldMappings 定义。
     */
    fun convertExamToStandard(context: Context, raw: JSONObject): JSONObject {
        val config = getServerConfig(context)
        val mappings = config?.optJSONObject("fieldMappings")?.optJSONObject("exam") ?: JSONObject()
        return convertExamToStandard(raw, mappings)
    }

    internal fun convertExamToStandard(raw: JSONObject, mappings: JSONObject): JSONObject {
        val standard = mapFields(raw, mappings)
        putFallback(standard, raw, "name", "KCM")
        putFallback(standard, raw, "course_name", "KCM")
        putExamDateTimes(standard, raw)
        putFallback(standard, raw, "exam_location", "JASMC")
        putFallback(standard, raw, "seat_number", "ZWH")
        putFallback(standard, raw, "term", "XNXQDM")
        return standard
    }

    internal fun emapRows(result: HttpResult, dataKey: String, jwxt: HttpUrl, cas: HttpUrl): JSONArray {
        checkStatus(result)
        if (isRedirect(result.code)) {
            requireJwxtDestination(redirectTarget(result), jwxt, cas)
            throw NotifyProtocolException("Unexpected EMAP redirect")
        }
        if (isLoginHtml(result.body)) {
            throw NotifySessionExpiredException("EMAP response requires login or MFA")
        }
        val json = try {
            JSONObject(result.body)
        } catch (e: JSONException) {
            throw NotifyProtocolException("EMAP response is not a JSON object", e)
        }
        // A business code, including a numeric 401/403, is not an HTTP authentication failure.
        val code = valueOrNull(json.opt("code"))
        if (code != "0" && !(code is Number && code.toDouble() == 0.0)) {
            throw NotifyProtocolException("EMAP business failure: code=${code ?: "missing"}, ${json.text("msg")}")
        }
        val rows = json.optJSONObject("datas")?.optJSONObject(dataKey)?.optJSONArray("rows")
            ?: throw NotifyProtocolException("EMAP response missing $dataKey rows")
        for (index in 0 until rows.length()) {
            if (rows.optJSONObject(index) == null) {
                throw NotifyProtocolException("EMAP response contains a non-object row")
            }
        }
        return rows
    }

    // ─── Fetch grades ───────────────────────────────────────────────────────

    fun fetchGrades(context: Context): FetchResult {
        val grades = mutableListOf<JSONObject>()

        try {
            val appBase = getAppBase(context)
            val appIdCjcx = getAppId(context, "grades")
            val apiCjcx = getApiPath(context, "grades")

            fetchWeu(context, appIdCjcx)

            // Match JS side: query all terms (no XNXQDM filter), same fixed filters
            val query = buildString {
                append("[{")
                append("\"name\":\"SFYX\",\"value\":\"1\",\"linkOpt\":\"and\",\"builder\":\"m_value_equal\"},{")
                append("\"name\":\"SHOWMAXCJ\",\"value\":0,\"linkOpt\":\"and\",\"builder\":\"equal\"},{")
                append("\"name\":\"BY1\",\"value\":\"1\",\"linkOpt\":\"and\",\"builder\":\"equal\"}]")
            }

            val postData = "querySetting=${URLEncoder.encode(query, "UTF-8")}&pageSize=999&pageNumber=1&*order=-XNXQDM,-KCH,-KXH"
            val rows = emapRows(
                httpPost("$appBase/$apiCjcx", postData),
                "xscjcx",
                getJwxtBase(context).toHttpUrl(),
                getCerBase(context).toHttpUrl()
            )

            for (i in 0 until rows.length()) {
                val raw = rows.getJSONObject(i)
                grades.add(convertGradeToStandard(context, raw))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch grades", e)
            return FetchResult.Failure(e)
        }

        return FetchResult.Success(grades)
    }

    // ─── Fetch exams ────────────────────────────────────────────────────────

    fun fetchExams(context: Context): FetchResult {
        val exams = mutableListOf<JSONObject>()

        try {
            val appBase = getAppBase(context)
            val appIdWdksap = getAppId(context, "exams")
            val apiWdksap = getApiPath(context, "exams")

            fetchWeu(context, appIdWdksap)
            val term = getCurrentTerm(context)
                ?: throw NotifyProtocolException("Exam response missing current term")

            val param = JSONObject().apply {
                put("XNXQDM", term)
                put("*order", "-KSRQ,-KSSJMS")
            }

            val postData = "requestParamStr=${URLEncoder.encode(param.toString(), "UTF-8")}"
            val rows = emapRows(
                httpPost("$appBase/$apiWdksap", postData),
                "cxxsksap",
                getJwxtBase(context).toHttpUrl(),
                getCerBase(context).toHttpUrl()
            )

            for (i in 0 until rows.length()) {
                val raw = rows.getJSONObject(i)
                exams.add(convertExamToStandard(context, raw))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch exams", e)
            return FetchResult.Failure(e)
        }

        return FetchResult.Success(exams)
    }

    // ─── Diff logic ─────────────────────────────────────────────────────────

    fun diffGrades(oldList: List<JSONObject>, newList: List<JSONObject>): List<JSONObject> {
        fun courseKey(grade: JSONObject): Pair<String, String> =
            grade.text("course_code").ifEmpty { grade.text("course_name") } to grade.text("term")

        fun sameRecord(old: JSONObject, current: JSONObject): Boolean {
            val oldId = old.text("record_id")
            val currentId = current.text("record_id")
            if (oldId.isNotEmpty() && currentId.isNotEmpty()) return oldId == currentId
            // Older baselines lack record/class IDs. Compare available attempt fields without
            // treating newly populated identifiers as new grades.
            return gradeAttemptFields.all { key ->
                val before = old.text(key)
                val after = current.text(key)
                before.isEmpty() || after.isEmpty() || before == after
            }
        }

        fun sameResult(old: JSONObject, current: JSONObject): Boolean =
            gradeResultFields.all { old.text(it) == current.text(it) }

        val oldGroups = oldList.groupBy(::courseKey).mapValues { (_, grades) -> grades.toMutableList() }
        val unmatched = mutableListOf<JSONObject>()
        // Reserve exact matches first so response ordering cannot consume an unchanged attempt
        // as a different attempt's score update. Lists preserve duplicate records.
        for (grade in newList) {
            val candidates = oldGroups[courseKey(grade)]
            val index = candidates?.indexOfFirst { sameRecord(it, grade) && sameResult(it, grade) } ?: -1
            if (index >= 0) candidates?.removeAt(index) else unmatched.add(grade)
        }
        // Every unmatched row is a new attempt or an existing attempt with a changed result.
        return unmatched
    }

    fun diffExams(oldList: List<JSONObject>, newList: List<JSONObject>): List<JSONObject> {
        fun examKey(it: JSONObject): String {
            return "${it.optString("name", "")}|${it.optString("start_at", "")}|${it.optString("time_text", "")}"
        }

        val oldMap = oldList.associateBy { examKey(it) }

        return newList.filter {
            val key = examKey(it)
            val old = oldMap[key]
            if (old == null) {
                true
            } else {
                old.optString("start_at", "") != it.optString("start_at", "") ||
                        old.optString("end_at", "") != it.optString("end_at", "") ||
                        old.optString("time_text", "") != it.optString("time_text", "") ||
                        old.optString("exam_location", "") != it.optString("exam_location", "") ||
                        old.optString("seat_number", "") != it.optString("seat_number", "")
            }
        }
    }

    // ─── Cache helpers ──────────────────────────────────────────────────────

    fun saveCachedGrades(context: Context, grades: List<JSONObject>) {
        val arr = JSONArray()
        for (g in grades) arr.put(g)
        UnifiedCache.putString(context, UnifiedCache.KEY_NOTIFY_CACHED_GRADES, arr.toString())
    }

    fun getCachedGrades(context: Context): List<JSONObject> {
        val str = UnifiedCache.getString(context, UnifiedCache.KEY_NOTIFY_CACHED_GRADES, "[]")
        return try {
            val arr = JSONArray(str)
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun saveCachedExams(context: Context, exams: List<JSONObject>) {
        val arr = JSONArray()
        for (e in exams) arr.put(e)
        UnifiedCache.putString(context, UnifiedCache.KEY_NOTIFY_CACHED_EXAMS, arr.toString())
    }

    fun getCachedExams(context: Context): List<JSONObject> {
        val str = UnifiedCache.getString(context, UnifiedCache.KEY_NOTIFY_CACHED_EXAMS, "[]")
        return try {
            val arr = JSONArray(str)
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
