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
import java.net.URLEncoder
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

object NotifyHelper {
    private const val TAG = "YsuNotify"

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
            for ((key, list) in cookieStore) {
                val parts = key.split("|", limit = 2)
                val domain = parts.getOrElse(0) { "" }
                val path = parts.getOrElse(1) { "/" }
                if (domainMatches(domain, url.host) && pathMatches(path, url.encodedPath)) {
                    for (c in list) {
                        if (!c.hasExpired()) {
                            result.add(c)
                        }
                    }
                }
            }
            return result
        }
    }

    private fun Cookie.hasExpired(): Boolean = expiresAt < System.currentTimeMillis()

    private fun domainMatches(cookieDomain: String, host: String): Boolean {
        val cd = cookieDomain.removePrefix(".").lowercase()
        val h = host.lowercase()
        return h == cd || h.endsWith(".$cd")
    }

    private fun pathMatches(cookiePath: String, requestPath: String): Boolean {
        if (cookiePath == "/") return true
        if (requestPath == cookiePath) return true
        val prefix = if (cookiePath.endsWith("/")) cookiePath else "$cookiePath/"
        return requestPath.startsWith(prefix)
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
        val date = normalizeDate(raw.optString("KSRQ", ""))
        val displayText = cleanText(raw.optString("KSSJMS", ""))
        val displayTimes = Regex("""\d{1,2}:\d{2}""").findAll(displayText)
            .map { normalizeTime(it.value) }
            .filter { it.isNotEmpty() }
            .toList()
        val startTime = normalizeTime(raw.optString("KSSJ", "")).ifEmpty { displayTimes.getOrNull(0) ?: "" }
        val endTime = normalizeTime(raw.optString("JSSJ", "")).ifEmpty { displayTimes.getOrNull(1) ?: "" }
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

    fun setSessionExpired(context: Context, expired: Boolean) {
        UnifiedCache.putBoolean(context, "session_expired", expired)
    }

    fun isSessionExpired(context: Context): Boolean {
        return UnifiedCache.getBoolean(context, "session_expired", false)
    }

    // ─── Cookie helpers ─────────────────────────────────────────────────────

    private fun getCookiesForHost(host: String): Map<String, String> {
        val result = mutableMapOf<String, String>()
        for ((key, list) in cookieStore) {
            val domain = key.split("|", limit = 2).getOrElse(0) { "" }
            if (domainMatches(domain, host)) {
                for (cookie in list) {
                    if (!cookie.hasExpired()) {
                        result[cookie.name] = cookie.value
                    }
                }
            }
        }
        return result
    }

    // ─── HTTP helpers ───────────────────────────────────────────────────────

    private fun buildGet(url: String): Request = Request.Builder()
        .url(url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .build()

    private data class HttpResult(val code: Int, val body: String, val finalUrl: String)

    /** 单次 GET，不跟随重定向。 */
    private fun httpGet(url: String): HttpResult {
        client.newCall(buildGet(url)).execute().use { resp ->
            val body = resp.body?.string() ?: ""
            val u = resp.request.url
            Log.d(TAG, "httpGet: code=${resp.code}, host=${u.host}, path=${u.encodedPath}")
            return HttpResult(resp.code, body, resp.request.url.toString())
        }
    }

    private fun httpPost(url: String, data: String): Pair<Int, String> {
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
            val code = resp.code
            val responseBody = resp.body?.string() ?: ""
            return Pair(code, responseBody)
        }
    }

    // ─── JWXT session establishment ─────────────────────────────────────────

    /**
     * 使用 CASTGC 建立 JWXT 会话。
     *
     * 流程：
     * 1. 请求 CAS（带 CASTGC），CAS 返回 302 到 JWXT（带 ticket）
     * 2. 手动跟随 CAS → JWXT 重定向（OkHttp 跨域会剥离 Cookie）
     * 3. JWXT 返回 302（带 Set-Cookie: GS_SESSIONID 等），**不再跟随此重定向**
     * 4. CookieJar 已存入会话 cookie，可直接用于后续请求
     *
     * @return true 如果成功建立会话，false 如果 CASTGC 过期。
     */
    fun establishSession(context: Context, castgc: String): Boolean {
        cookieStore.clear()

        // 种入 CASTGC
        val cerHost = getCerBase(context).toHttpUrl().host
        val castgcCookie = Cookie.Builder()
            .domain(cerHost)
            .path("/authserver")
            .name("CASTGC")
            .value(castgc)
            .build()
        cookieStore["$cerHost|/authserver"] = mutableListOf(castgcCookie)

        val portalUrl = getPortalUrl(context)
        val cerBase = getCerBase(context)
        val service = URLEncoder.encode(portalUrl, "UTF-8")
        val casUrl = "$cerBase/authserver/login?service=$service"

        // Step 1: 请求 CAS，跟随 CAS → JWXT 的重定向
        var casRespUrl: String
        try {
            client.newCall(buildGet(casUrl)).execute().use { resp ->
                casRespUrl = resp.request.url.toString()
                Log.d(TAG, "CAS response: code=${resp.code}, url=$casRespUrl")

                // CAS 直接返回非重定向 → 可能是登录页
                if (resp.code !in setOf(301, 302, 303, 307, 308)) {
                    if (casRespUrl.contains("authserver/login")) {
                        Log.w(TAG, "CASTGC expired, CAS returned login page")
                        return false
                    }
                    // CAS 直接返回 200（已有有效 session），但我们需要 JWXT 的 cookie
                    // 继续请求 JWXT portal
                }

                // 跟随 CAS 的 302 到 JWXT
                val location = resp.header("Location")
                if (location.isNullOrEmpty()) {
                    Log.w(TAG, "CAS redirect without Location header")
                    return false
                }
                casRespUrl = if (location.startsWith("http://") || location.startsWith("https://")) {
                    location
                } else {
                    resp.request.url.resolve(location)?.toString() ?: return false
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "CAS request failed", e)
            return false
        }

        // Step 2: 请求 JWXT（带 ticket），不跟随重定向
        // JWXT 返回 302 + Set-Cookie（GS_SESSIONID 等），这就是我们需要的会话 cookie
        try {
            client.newCall(buildGet(casRespUrl)).execute().use { resp ->
                Log.d(TAG, "JWXT response: code=${resp.code}, url=${resp.request.url}")

                if (resp.code in setOf(301, 302, 303, 307, 308)) {
                    // 302 是预期的（重定向到不带 ticket 的 index.do），cookie 已在 CookieJar 中
                    return true
                }

                if (resp.request.url.toString().contains("authserver/login")) {
                    Log.w(TAG, "JWXT bounced to CAS login, ticket invalid")
                    return false
                }

                return resp.code == 200
            }
        } catch (e: Exception) {
            Log.e(TAG, "JWXT request failed", e)
            return false
        }
    }

    // ─── WEU management ─────────────────────────────────────────────────────

    /** 访问 appShow.do 获取指定应用的 _WEU cookie。 */
    fun fetchWeu(context: Context, appId: String): String? {
        val jwxtBase = getJwxtBase(context)
        val url = "$jwxtBase/jwapp/sys/emaphome/appShow.do?id=$appId"
        val result = httpGet(url)
        Log.d(TAG, "appShow: appId=$appId, code=${result.code}, finalUrl=${result.finalUrl}")

        if (result.code != 200) {
            Log.w(TAG, "appShow failed: code=${result.code}")
            return null
        }

        val cookies = getCookiesForHost(url.toHttpUrl().host)
        val weu = cookies["_WEU"]
        Log.d(TAG, "WEU for appId=$appId: ${weu != null}")
        return weu
    }

    // ─── Current term ───────────────────────────────────────────────────────

    fun getCurrentTerm(context: Context): String? {
        val appBase = getAppBase(context)
        val apiPath = getApiPath(context, "currentTerm")
        val (code, body) = httpPost("$appBase/$apiPath", "")
        if (code != 200) {
            Log.w(TAG, "getCurrentTerm failed: code=$code")
            return null
        }

        return try {
            val json = JSONObject(body)
            val datas = json.optJSONObject("datas") ?: return null
            val dqxnxq = datas.optJSONObject("dqxnxq") ?: return null
            val rows = dqxnxq.optJSONArray("rows") ?: return null
            if (rows.length() == 0) return null
            rows.getJSONObject(0).optString("DM").takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse current term", e)
            null
        }
    }

    // ─── Format conversion ──────────────────────────────────────────────────

    /**
     * 从 mappings 中解析 raw key。JS 端可能发送字符串或字符串数组（优先候选列表）。
     */
    private fun resolveRawKeys(mappings: JSONObject, standardKey: String): List<String> {
        val value = mappings.opt(standardKey) ?: return listOf(standardKey)
        return when (value) {
            is JSONArray -> (0 until value.length()).mapNotNull {
                val s = value.optString(it, "")
                if (s.isNotEmpty()) s else null
            }
            is String -> listOf(value)
            else -> listOf(standardKey)
        }
    }

    /**
     * 将原始成绩对象转换为标准格式，字段名由 server config 中的 fieldMappings 定义。
     */
    fun convertGradeToStandard(context: Context, raw: JSONObject): JSONObject {
        val config = getServerConfig(context)
        val mappings = config?.optJSONObject("fieldMappings")?.optJSONObject("grade") ?: JSONObject()
        val standard = JSONObject()
        val keys = mappings.keys()
        while (keys.hasNext()) {
            val standardKey = keys.next()
            for (rawKey in resolveRawKeys(mappings, standardKey)) {
                if (raw.has(rawKey)) {
                    standard.put(standardKey, raw.opt(rawKey))
                    break
                }
            }
        }
        // Fallback: ensure essential keys exist using common raw keys
        if (!standard.has("course_name")) {
            val name = raw.optString("XSKCM", raw.optString("KCM", ""))
            if (name.isNotEmpty()) standard.put("course_name", name)
        }
        if (!standard.has("course_code")) {
            val code = raw.optString("XSKCH", raw.optString("KCH", ""))
            if (code.isNotEmpty()) standard.put("course_code", code)
        }
        if (!standard.has("score")) {
            val score = raw.optString("ZCJ", raw.optString("BFZCJ", ""))
            if (score.isNotEmpty()) standard.put("score", score)
        }
        if (!standard.has("credit")) {
            val credit = raw.optString("XF", "")
            if (credit.isNotEmpty()) standard.put("credit", credit)
        }
        if (!standard.has("term")) {
            val term = raw.optString("XNXQDM", "")
            if (term.isNotEmpty()) standard.put("term", term)
        }
        if (!standard.has("exam_type")) {
            val type = raw.optString("KSXS", "")
            if (type.isNotEmpty()) standard.put("exam_type", type)
        }
        return standard
    }

    /**
     * 将原始考试对象转换为标准格式，字段名由 server config 中的 fieldMappings 定义。
     */
    fun convertExamToStandard(context: Context, raw: JSONObject): JSONObject {
        val config = getServerConfig(context)
        val mappings = config?.optJSONObject("fieldMappings")?.optJSONObject("exam") ?: JSONObject()
        val standard = JSONObject()
        val keys = mappings.keys()
        while (keys.hasNext()) {
            val standardKey = keys.next()
            for (rawKey in resolveRawKeys(mappings, standardKey)) {
                if (raw.has(rawKey)) {
                    standard.put(standardKey, raw.opt(rawKey))
                    break
                }
            }
        }
        // Fallback: ensure essential keys exist using common raw keys
        if (!standard.has("name")) {
            val name = raw.optString("KCM", "")
            if (name.isNotEmpty()) standard.put("name", name)
        }
        if (!standard.has("course_name")) {
            val name = raw.optString("KCM", "")
            if (name.isNotEmpty()) standard.put("course_name", name)
        }
        putExamDateTimes(standard, raw)
        if (!standard.has("exam_location")) {
            val loc = raw.optString("JASMC", "")
            if (loc.isNotEmpty()) standard.put("exam_location", loc)
        }
        if (!standard.has("seat_number")) {
            val seat = raw.optString("ZWH", "")
            if (seat.isNotEmpty()) standard.put("seat_number", seat)
        }
        if (!standard.has("term")) {
            val term = raw.optString("XNXQDM", "")
            if (term.isNotEmpty()) standard.put("term", term)
        }
        return standard
    }

    // ─── Fetch grades ───────────────────────────────────────────────────────

    fun fetchGrades(context: Context): List<JSONObject> {
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
            val (code, body) = httpPost("$appBase/$apiCjcx", postData)

            if (code != 200) {
                Log.w(TAG, "fetchGrades failed: code=$code")
                return grades
            }

            val json = JSONObject(body)
            val datas = json.optJSONObject("datas") ?: return grades
            val xscjcx = datas.optJSONObject("xscjcx") ?: return grades
            val rows = xscjcx.optJSONArray("rows") ?: return grades

            for (i in 0 until rows.length()) {
                val raw = rows.getJSONObject(i)
                grades.add(convertGradeToStandard(context, raw))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch grades", e)
        }

        return grades
    }

    // ─── Fetch exams ────────────────────────────────────────────────────────

    fun fetchExams(context: Context): List<JSONObject> {
        val exams = mutableListOf<JSONObject>()

        try {
            val appBase = getAppBase(context)
            val appIdWdksap = getAppId(context, "exams")
            val apiWdksap = getApiPath(context, "exams")

            fetchWeu(context, appIdWdksap)
            val term = getCurrentTerm(context) ?: ""

            val param = JSONObject().apply {
                put("XNXQDM", term)
                put("*order", "-KSRQ,-KSSJMS")
            }

            val postData = "requestParamStr=${URLEncoder.encode(param.toString(), "UTF-8")}"
            val (code, body) = httpPost("$appBase/$apiWdksap", postData)

            if (code != 200) {
                Log.w(TAG, "fetchExams failed: code=$code")
                return exams
            }

            val json = JSONObject(body)
            val datas = json.optJSONObject("datas") ?: return exams
            val cxxsksap = datas.optJSONObject("cxxsksap") ?: return exams
            val rows = cxxsksap.optJSONArray("rows") ?: return exams

            for (i in 0 until rows.length()) {
                val raw = rows.getJSONObject(i)
                exams.add(convertExamToStandard(context, raw))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch exams", e)
        }

        return exams
    }

    // ─── Diff logic ─────────────────────────────────────────────────────────

    fun diffGrades(oldList: List<JSONObject>, newList: List<JSONObject>): List<JSONObject> {
        fun gradeKey(it: JSONObject): String {
            val code = it.optString("course_code", "")
            if (code.isNotEmpty()) return "$code|${it.optString("term", "")}"
            val name = it.optString("course_name", "")
            return "$name|${it.optString("term", "")}"
        }

        val oldKeys = oldList.map { gradeKey(it) }.toSet()

        return newList.filter {
            !oldKeys.contains(gradeKey(it))
        }
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
        UnifiedCache.putString(context, UnifiedCache.KEY_CACHED_GRADES, arr.toString())
    }

    fun getCachedGrades(context: Context): List<JSONObject> {
        val str = UnifiedCache.getString(context, UnifiedCache.KEY_CACHED_GRADES, "[]")
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
        UnifiedCache.putString(context, UnifiedCache.KEY_CACHED_EXAMS, arr.toString())
    }

    fun getCachedExams(context: Context): List<JSONObject> {
        val str = UnifiedCache.getString(context, UnifiedCache.KEY_CACHED_EXAMS, "[]")
        return try {
            val arr = JSONArray(str)
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
