package me.uwen.orahako.companion.ysu

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class YsuNotifyProtocolTest {
    private val jwxt = "https://jwxt.ysu.edu.cn".toHttpUrl()
    private val cas = "https://cer.ysu.edu.cn".toHttpUrl()
    private val portal = "$jwxt" + "jwapp/sys/emaphome/portal/index.do"
    private val login = "$cas" + "authserver/login"

    private fun session(
        code: Int,
        body: String = "",
        location: String? = null,
        hasSession: Boolean = true,
        fromCas: Boolean = false
    ) = YsuNotifyProtocol.sessionDestination(
        YsuNotifyProtocol.HttpResult(code, body, if (fromCas) login else portal, location),
        jwxt,
        cas,
        hasSession,
        fromCas
    )

    private fun rows(code: Int, body: String = "", location: String? = null): JSONArray =
        YsuNotifyProtocol.emapRows(YsuNotifyProtocol.HttpResult(code, body, portal, location), "xscjcx", jwxt, cas)

    private fun grade(score: Any, examType: String = "正常考试", id: String? = null): JSONObject =
        JSONObject().put("course_code", "C101").put("term", "2025-2026-1")
            .put("score", score).put("exam_type", examType).apply {
                if (id != null) put("record_id", id)
            }

    @Test
    fun casServerErrorsAreNotExpiredCredentialsEvenWhenBodyLooksLikeLogin() {
        for (status in listOf(500, 503)) {
            assertThrows(NotifyProtocolException::class.java) {
                session(status, "<html>authserver/login</html>", fromCas = true)
            }
        }
        assertThrows(NotifyProtocolException::class.java) {
            session(200, "<html>Maintenance</html>", fromCas = true)
        }
        assertThrows(NotifySessionExpiredException::class.java) {
            session(200, "<html><form><input type='password'></form></html>", fromCas = true)
        }
    }

    @Test
    fun jwxtRedirectRequiresTrustedDestinationAndSessionEvidence() {
        assertEquals(portal.toHttpUrl(), session(302, location = "/jwapp/sys/emaphome/portal/index.do"))
        assertEquals(portal.toHttpUrl(), session(200, body = "<html>Portal</html>"))
        for (status in listOf(200, 302)) {
            assertThrows(NotifyProtocolException::class.java) {
                session(status, location = portal, hasSession = false)
            }
        }
        assertThrows(NotifyProtocolException::class.java) { session(302) }
        assertThrows(NotifyProtocolException::class.java) {
            session(302, location = "https://jwxt.ysu.edu.cn.attacker.test/jwapp/portal")
        }
        assertThrows(NotifyProtocolException::class.java) {
            session(302, location = "http://jwxt.ysu.edu.cn/jwapp/portal")
        }
        assertThrows(NotifyProtocolException::class.java) {
            session(302, location = "https://attacker.test/authserver/login")
        }
    }

    @Test
    fun casAndJwxtRejectLoginAndMfaRedirects() {
        for (destination in listOf(login, "$cas" + "authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true")) {
            for (fromCas in listOf(false, true)) {
                assertThrows(NotifySessionExpiredException::class.java) {
                    session(302, location = destination, fromCas = fromCas)
                }
            }
        }
        assertEquals(portal.toHttpUrl(), session(302, location = portal, fromCas = true, hasSession = false))
    }

    @Test
    fun emapSeparatesAuthenticationFromBusinessAndMalformedResponses() {
        for (status in listOf(401, 403)) {
            assertThrows(NotifySessionExpiredException::class.java) { rows(status) }
            assertThrows(NotifyProtocolException::class.java) {
                rows(200, """{"code":$status,"msg":"request rejected"}""")
            }
        }
        assertThrows(NotifySessionExpiredException::class.java) { rows(302, location = login) }
        assertThrows(NotifySessionExpiredException::class.java) {
            rows(200, "<html><form action='/authserver/login'></form></html>")
        }
        for (body in listOf("<html>Upstream error</html>", "not json", "{}", """{"code":0,"datas":{}}""")) {
            assertThrows(NotifyProtocolException::class.java) { rows(200, body) }
        }
        assertThrows(NotifyProtocolException::class.java) { rows(503, "<html>authserver/login</html>") }
        assertThrows(NotifyProtocolException::class.java) { rows(302, location = portal) }
    }

    @Test
    fun emapAllowsEmptySuccessfulDatasetButRejectsInvalidRows() {
        assertEquals(0, rows(200, """{"code":"0","datas":{"xscjcx":{"rows":[]}}}""").length())
        assertEquals(80, rows(200, """{"code":0,"datas":{"xscjcx":{"rows":[{"ZCJ":80}]}}}""").getJSONObject(0).getInt("ZCJ"))
        assertThrows(NotifyProtocolException::class.java) {
            rows(200, """{"code":0,"datas":{"xscjcx":{"rows":[null]}}}""")
        }
    }

    @Test
    fun mappingsSkipNullAndBlankCandidatesWithoutDroppingZero() {
        val mappings = JSONObject("""{"course_name":[null,"XSKCM","EMPTY","KCM"],"score":["MISSING","ZCJ","XSZCJMC"]}""")
        val raw = JSONObject().put("XSKCM", JSONObject.NULL).put("EMPTY", " ")
            .put("KCM", "Mathematics").put("ZCJ", 0).put("XSZCJMC", "不及格")
        val result = YsuNotifyProtocol.convertGradeToStandard(raw, mappings)
        assertEquals("Mathematics", result.getString("course_name"))
        assertEquals(0, result.getInt("score"))
        val fallback = YsuNotifyProtocol.convertGradeToStandard(raw.put("ZCJ", JSONObject.NULL), JSONObject())
        assertEquals("不及格", fallback.getString("score"))
    }

    @Test
    fun nullExamDisplayTimeUsesActualTimesAndNullTermStaysAbsent() {
        val raw = JSONObject().put("KSRQ", "2026-09-12").put("KSSJ", "09:00")
            .put("JSSJ", "11:00").put("KSSJMS", JSONObject.NULL).put("XNXQDM", JSONObject.NULL)
            .put("ZWH", 0)
        val exam = YsuNotifyProtocol.convertExamToStandard(raw, JSONObject())
        assertEquals("2026-09-12T09:00:00", exam.getString("start_at"))
        assertEquals("09:00-11:00", exam.getString("time_text"))
        assertEquals(0, exam.getInt("seat_number"))
        assertFalse(exam.has("term"))
    }

    @Test
    fun addedMakeupAndUpdatedOriginalGradeAreBothReported() {
        val old = grade(50, id = "original")
        val updated = grade(55, id = "original")
        val makeup = grade(70, examType = "补考", id = "makeup")
        assertEquals(listOf(updated, makeup), YsuNotifyProtocol.diffGrades(listOf(old), listOf(updated, makeup)))
        assertEquals(listOf(makeup), YsuNotifyProtocol.diffGrades(listOf(old), listOf(old, makeup)))
    }

    @Test
    fun attemptsWithoutRecordIdsPreserveDuplicatesAndIgnoreReordering() {
        val failed = grade(50)
        val passed = grade(70)
        val changed = grade(75)
        assertEquals(emptyList<JSONObject>(), YsuNotifyProtocol.diffGrades(listOf(failed, passed), listOf(passed, failed)))
        assertEquals(listOf(changed), YsuNotifyProtocol.diffGrades(listOf(failed, passed), listOf(changed, failed)))
        assertEquals(listOf(passed), YsuNotifyProtocol.diffGrades(listOf(passed), listOf(passed, passed)))
    }

    @Test
    fun newSameScoreRecordIsNotLostAndMetadataDoesNotNotify() {
        val old = grade(80, id = "first")
        val additional = grade(80, id = "second")
        assertEquals(listOf(additional), YsuNotifyProtocol.diffGrades(listOf(old), listOf(old, additional)))
        val metadata = grade("80", id = "first").put("department", "Renamed department")
        assertEquals(emptyList<JSONObject>(), YsuNotifyProtocol.diffGrades(listOf(old), listOf(metadata)))
        assertEquals(emptyList<JSONObject>(), YsuNotifyProtocol.diffGrades(listOf(grade(80)), listOf(old)))
    }
}
