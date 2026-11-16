package me.uwen.orahako.nativebridge

import org.json.JSONArray
import org.json.JSONObject

/** Converts org.json values into plain Kotlin values for capability payloads. */
internal fun jsonValueToKotlin(value: Any?): Any? = when (value) {
    null, JSONObject.NULL -> null
    is JSONObject -> value.keys().asSequence().associateWith { jsonValueToKotlin(value.get(it)) }
    is JSONArray -> (0 until value.length()).map { jsonValueToKotlin(value.get(it)) }
    else -> value
}

/**
 * Converts plain Kotlin values into values accepted by JSObject/JSONArray.
 *
 * Public because capability modules build their own JSON results from the
 * generic payload maps.
 */
fun kotlinValueToJson(value: Any?): Any = when (value) {
    null -> JSONObject.NULL
    is JSONObject -> value
    is JSONArray -> value
    is Map<*, *> -> JSONObject().apply {
        value.forEach { (key, item) -> put(key.toString(), kotlinValueToJson(item)) }
    }
    is Iterable<*> -> JSONArray().apply { value.forEach { put(kotlinValueToJson(it)) } }
    is Array<*> -> JSONArray().apply { value.forEach { put(kotlinValueToJson(it)) } }
    else -> value
}
