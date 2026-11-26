package me.uwen.orahako.nativebridge.capabilities.polling

import android.content.Context
import me.uwen.orahako.companion.ysu.YsuBackgroundTaskHandler
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundTaskDispatchTest {

    private class StubHandler(override val id: String) : BackgroundTaskHandler {
        override fun run(context: Context, payload: JSONObject): BackgroundTaskResult =
            BackgroundTaskResult.SUCCESS
    }

    @After
    fun clearRegistry() {
        BackgroundTaskHandlers.clear()
    }

    @Test
    fun resolvesOnlyExplicitlyRegisteredAdapters() {
        val demo = StubHandler("demo")
        BackgroundTaskHandlers.register(demo)

        assertSame(demo, BackgroundTaskDispatch.resolve("demo"))
        assertEquals(listOf("demo"), BackgroundTaskHandlers.registeredIds())
    }

    @Test
    fun anUnregisteredIdNeverFallsBackToTheYsuAdapter() {
        BackgroundTaskHandlers.register(YsuBackgroundTaskHandler)

        assertSame(YsuBackgroundTaskHandler, BackgroundTaskDispatch.resolve("ysu"))
        assertThrows(UnknownBackgroundTaskHandlerException::class.java) {
            BackgroundTaskDispatch.resolve("missing")
        }
    }

    @Test
    fun aNonYsuAdapterIsDispatchedByItsOwnId() {
        val demo = StubHandler("demo")
        val ysu = StubHandler("ysu")
        BackgroundTaskHandlers.register(ysu)
        BackgroundTaskHandlers.register(demo)

        assertSame(demo, BackgroundTaskDispatch.resolve("demo"))
        assertSame(ysu, BackgroundTaskDispatch.resolve("ysu"))
    }

    @Test
    fun payloadParsingRejectsMalformedInputWithoutThrowing() {
        assertEquals(0, BackgroundTaskDispatch.payload(null).length())
        assertEquals(0, BackgroundTaskDispatch.payload("  ").length())
        assertEquals(0, BackgroundTaskDispatch.payload("not json").length())
        assertEquals("value", BackgroundTaskDispatch.payload("""{"key":"value"}""").getString("key"))
        assertEquals(0, BackgroundTaskDispatch.payload("{}").length())
    }
}
