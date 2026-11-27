package me.uwen.orahako.nativebridge.capabilities.background

import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class BackgroundJsRuntimeTest {

    private class FakeHostBridge(
        private val httpResponder: (JSONObject) -> JSONObject = {
            JSONObject()
                .put("status", 200)
                .put("url", it.optString("url"))
                .put("headers", JSONObject())
                .put("setCookies", org.json.JSONArray())
                .put("body", """{"ok":true}""")
        },
    ) : BackgroundHostBridge {
        val storage = LinkedHashMap<String, String>()
        val channels = mutableListOf<JSONObject>()
        val notifications = mutableListOf<JSONObject>()
        val logs = mutableListOf<String>()
        var lastDiagnostics: JSONObject? = null

        override suspend fun httpSend(requestJson: String): String =
            httpResponder(JSONObject(requestJson)).toString()

        override suspend fun storageGet(key: String): String? = storage[key]

        override suspend fun storageSet(key: String, value: String) {
            storage[key] = value
        }

        override suspend fun storageRemove(key: String) {
            storage.remove(key)
        }

        override suspend fun ensureNotificationChannel(specJson: String): Boolean {
            channels += JSONObject(specJson)
            return true
        }

        override suspend fun postNotification(specJson: String): String {
            val obj = JSONObject(specJson)
            notifications += obj
            return JSONObject().put("id", notifications.size).put("posted", true).toString()
        }

        override suspend fun cancelNotification(targetJson: String): Int = 1

        override suspend fun saveDiagnostics(diagnosticsJson: String) {
            lastDiagnostics = JSONObject(diagnosticsJson)
        }

        override fun log(level: String, message: String) {
            logs += "$level:$message"
        }
    }

    @Test
    fun executesAsyncPluginBackgroundTaskWithHttpStorageAndNotifications() = runTest {
        val bridge = FakeHostBridge { req ->
            JSONObject()
                .put("status", 200)
                .put("url", req.getString("url"))
                .put("headers", JSONObject().put("content-type", "application/json"))
                .put("setCookies", org.json.JSONArray().put("SESSION=abc; Path=/"))
                .put("body", """{"booksDue":2}""")
        }

        val script = """
            globalThis.__orahakoBackgroundTask = async function (ctx, payload) {
              console.log('running', ctx.pluginId, ctx.taskId);
              const encoded = btoa('hello');
              if (atob(encoded) !== 'hello') throw new Error('base64 mismatch');
              const utf8 = new TextDecoder().decode(new TextEncoder().encode('酸橙盒'));
              if (utf8 !== '酸橙盒') throw new Error('utf8 mismatch');

              const resp = await ctx.http.send({ url: payload.endpoint, method: 'GET' });
              const data = JSON.parse(resp.body);
              const prev = Number((await ctx.storage.getItem('due')) || '0');
              await ctx.storage.setItem('due', String(data.booksDue));
              if (data.booksDue > prev) {
                await ctx.notifications.ensureChannel({
                  id: 'library_due',
                  name: 'Library Due',
                  importance: 'high',
                });
                await ctx.notifications.post({
                  channelId: 'library_due',
                  title: '还书提醒',
                  body: '有 ' + data.booksDue + ' 本书即将到期',
                  deepLink: 'orahako://settings',
                });
              }
              await ctx.state.setDiagnostics({ due: data.booksDue, plugin: ctx.pluginId });
              return 'success';
            };
        """.trimIndent()

        val outcome = BackgroundJsRuntime.execute(
            pluginId = "community.library",
            taskId = "library-check",
            script = script,
            payloadJson = """{"endpoint":"https://lib.example.edu/api/due"}""",
            bridge = bridge,
        )

        assertEquals(BackgroundExecutionOutcome.SUCCESS, outcome)
        assertEquals("2", bridge.storage["due"])
        assertEquals(1, bridge.channels.size)
        assertEquals("library_due", bridge.channels[0].getString("id"))
        assertEquals(1, bridge.notifications.size)
        assertEquals("还书提醒", bridge.notifications[0].getString("title"))
        assertEquals(2, bridge.lastDiagnostics?.getInt("due"))
        assertTrue(bridge.logs.any { it.contains("community.library") })
    }

    @Test
    fun mapsRetryAndSkippedOutcomes() = runTest {
        val bridge = FakeHostBridge()
        val retryOutcome = BackgroundJsRuntime.execute(
            pluginId = "test.plugin",
            taskId = "t1",
            script = "globalThis.__orahakoBackgroundTask = async () => 'retry';",
            payloadJson = "{}",
            bridge = bridge,
        )
        val skippedOutcome = BackgroundJsRuntime.execute(
            pluginId = "test.plugin",
            taskId = "t2",
            script = "globalThis.__orahakoBackgroundTask = async () => 'skipped';",
            payloadJson = "{}",
            bridge = bridge,
        )
        assertEquals(BackgroundExecutionOutcome.RETRY, retryOutcome)
        assertEquals(BackgroundExecutionOutcome.SKIPPED, skippedOutcome)
    }

    @Test
    fun enforcesTimeoutGuardrailOnStalledAsyncTasks() = runTest {
        val bridge = FakeHostBridge()
        try {
            BackgroundJsRuntime.execute(
                pluginId = "test.plugin",
                taskId = "slow",
                script = """
                    globalThis.__orahakoBackgroundTask = async () => {
                      await new Promise((resolve) => setTimeout(resolve, 10000));
                      return 'success';
                    };
                """.trimIndent(),
                payloadJson = "{}",
                bridge = bridge,
                timeoutMs = 1_000L,
            )
            fail("Expected timeout cancellation")
        } catch (_: TimeoutCancellationException) {
            // Expected guardrail behavior
        }
    }
}
