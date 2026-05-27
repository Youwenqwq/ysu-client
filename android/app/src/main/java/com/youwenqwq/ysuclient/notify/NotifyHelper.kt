package com.youwenqwq.ysuclient.notify

import android.content.Context
import android.util.Log
import com.youwenqwq.ysuclient.cache.UnifiedCache
import org.json.JSONArray
import org.json.JSONObject
import java.net.CookieHandler
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * 通知模块核心逻辑：HTTP 请求、Cookie 管理、Diff、缓存。
 *
 * 每次 Worker 运行时都使用 CASTGC 重新建立 JWXT 会话，不依赖持久化的 session cookies。
 * 学校配置从 UnifiedCache 读取，支持 JS 端动态下发。
 */
object NotifyHelper {
    private const val TAG = "YsuNotify"

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

    fun saveSettings(context: Context, interval: Int, grades: Boolean, exams: Boolean) {
        val obj = JSONObject().apply {
            put("interval", interval)
            put("grades", grades)
            put("exams", exams)
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

    fun setSessionExpired(context: Context, expired: Boolean) {
        UnifiedCache.putBoolean(context, "session_expired", expired)
    }

    fun isSessionExpired(context: Context): Boolean {
        return UnifiedCache.getBoolean(context, "session_expired", false)
    }

    // ─── Manual cookie jar ──────────────────────────────────────────────────

    private val cookieJar = mutableMapOf<String, String>()

    private fun clearCookies() {
        cookieJar.clear()
    }

    private fun setCookie(name: String, value: String) {
        cookieJar[name] = value
    }

    private fun getCookieHeader(): String {
        return cookieJar.entries.joinToString("; ") { "${it.key}=${it.value}" }
    }

    private fun parseSetCookie(header: String?) {
        if (header == null) return
        val cookiePart = header.substringBefore(";").trim()
        if (cookiePart.isEmpty()) return
        val eqIdx = cookiePart.indexOf('=')
        if (eqIdx > 0) {
            val name = cookiePart.substring(0, eqIdx).trim()
            val value = cookiePart.substring(eqIdx + 1).trim()
            cookieJar[name] = value
        }
    }

    private fun parseSetCookies(conn: HttpURLConnection) {
        val headers = conn.headerFields ?: return
        for ((key, values) in headers) {
            if ("Set-Cookie".equals(key, ignoreCase = true)) {
                for (value in values) {
                    parseSetCookie(value)
                }
            }
        }
    }

    private fun applyCookies(conn: HttpURLConnection) {
        val header = getCookieHeader()
        if (header.isNotEmpty()) {
            conn.setRequestProperty("Cookie", header)
        }
    }

    private inline fun <T> withCookieHandlerDisabled(block: () -> T): T {
        val oldHandler = CookieHandler.getDefault()
        CookieHandler.setDefault(null)
        try {
            return block()
        } finally {
            CookieHandler.setDefault(oldHandler)
        }
    }

    // ─── HTTP helpers ───────────────────────────────────────────────────────

    private fun httpGet(url: String, timeout: Int = 15000): Triple<Int, String, String> = withCookieHandlerDisabled {
        var currentUrl = url
        var code: Int = 0
        var body: String = ""
        var finalUrl = url

        for (i in 0 until 10) {
            val conn = URL(currentUrl).openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.instanceFollowRedirects = false
            conn.connectTimeout = timeout
            conn.readTimeout = timeout
            conn.setRequestProperty(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36"
            )
            applyCookies(conn)

            code = conn.responseCode
            body = try {
                conn.inputStream.bufferedReader().use { it.readText() }
            } catch (_: Exception) {
                conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            }
            parseSetCookies(conn)
            finalUrl = conn.url.toString()

            if (code !in setOf(301, 302, 303, 307, 308)) break

            val location = conn.getHeaderField("Location")
            if (location.isNullOrEmpty()) break

            currentUrl = if (location.startsWith("http://") || location.startsWith("https://")) {
                location
            } else {
                URL(URL(finalUrl), location).toString()
            }
        }

        Triple(code, body, finalUrl)
    }

    private fun httpPost(url: String, data: String, timeout: Int = 15000): Pair<Int, String> = withCookieHandlerDisabled {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.instanceFollowRedirects = true
        conn.connectTimeout = timeout
        conn.readTimeout = timeout
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
        conn.setRequestProperty("X-Requested-With", "XMLHttpRequest")
        conn.setRequestProperty("Accept", "application/json, text/javascript, */*; q=0.01")
        conn.setRequestProperty(
            "User-Agent",
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36"
        )
        applyCookies(conn)

        conn.outputStream.use { it.write(data.toByteArray(Charsets.UTF_8)) }

        val code = conn.responseCode
        val body = try {
            conn.inputStream.bufferedReader().use { it.readText() }
        } catch (_: Exception) {
            conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
        }
        parseSetCookies(conn)
        Pair(code, body)
    }

    // ─── JWXT session establishment ─────────────────────────────────────────

    /**
     * 使用 CASTGC 建立 JWXT 会话。
     * 流程：访问 CAS login（带 service=portal）→ CAS 验证 CASTGC 后重定向回 portal → portal 验证 ticket 建立 session。
     * 注意：跳转到 JWXT domain 前清除 CAS cookies，避免同名 cookie（如 JSESSIONID）干扰。
     * @return true 如果成功建立会话，false 如果 CASTGC 过期。
     */
    fun establishSession(context: Context, castgc: String): Boolean = withCookieHandlerDisabled {
        clearCookies()
        setCookie("CASTGC", castgc)

        val portalUrl = getPortalUrl(context)
        val cerBase = getCerBase(context)
        val service = URLEncoder.encode(portalUrl, "UTF-8")
        val casUrl = "$cerBase/authserver/login?service=$service"

        var currentUrl = casUrl
        for (step in 0 until 10) {
            val conn = URL(currentUrl).openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9")
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36")
            applyCookies(conn)

            val code = conn.responseCode
            val body = try {
                conn.inputStream.bufferedReader().use { it.readText() }
            } catch (_: Exception) {
                conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            }
            parseSetCookies(conn)
            val finalUrl = conn.url.toString()

            Log.d(TAG, "CAS step $step: code=$code, url=$finalUrl")

            if (code !in setOf(301, 302, 303, 307, 308)) {
                if (finalUrl.contains("authserver/login") || body.contains("authserver/login")) {
                    Log.w(TAG, "CASTGC expired, bounced back to CAS login")
                    return@withCookieHandlerDisabled false
                }
                return@withCookieHandlerDisabled code == 200
            }

            val location = conn.getHeaderField("Location")
            if (location.isNullOrEmpty()) {
                Log.w(TAG, "CAS redirect without Location header")
                return@withCookieHandlerDisabled false
            }

            val nextUrl = if (location.startsWith("http://") || location.startsWith("https://")) {
                location
            } else {
                URL(URL(finalUrl), location).toString()
            }

            currentUrl = nextUrl
        }

        Log.w(TAG, "Too many CAS redirects")
        false
    }

    // ─── WEU management ─────────────────────────────────────────────────────

    /** 访问 appShow.do 获取指定应用的 _WEU cookie。 */
    fun fetchWeu(context: Context, appId: String): String? {
        val jwxtBase = getJwxtBase(context)
        val url = "$jwxtBase/jwapp/sys/emaphome/appShow.do?id=$appId"
        val (code, _, finalUrl) = httpGet(url)
        Log.d(TAG, "appShow: appId=$appId, code=$code, finalUrl=$finalUrl")

        if (code != 200) {
            Log.w(TAG, "appShow failed: code=$code")
            return null
        }

        val weu = cookieJar["_WEU"]
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
        if (!standard.has("exam_date")) {
            val date = raw.optString("KSRQ", "")
            if (date.isNotEmpty()) standard.put("exam_date", date)
        }
        if (!standard.has("exam_time")) {
            val time = raw.optString("KSSJMS", raw.optString("KSSJ", ""))
            if (time.isNotEmpty()) standard.put("exam_time", time)
        }
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
        val oldMap = oldList.associateBy {
            "${it.optString("name", "")}|${it.optString("exam_date", "")}"
        }

        return newList.filter {
            val key = "${it.optString("name", "")}|${it.optString("exam_date", "")}"
            val old = oldMap[key]
            if (old == null) {
                true
            } else {
                old.optString("exam_time", "") != it.optString("exam_time", "") ||
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
