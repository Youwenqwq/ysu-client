package me.uwen.orahako.nativebridge

import android.content.Context
import org.json.JSONException
import org.json.JSONObject

/**
 * Auditable subset of `assets/native-companion.json`: which capabilities the
 * native build enables and the configuration copied into their descriptors.
 */
class NativeCompanionConfig private constructor(
    val version: Int,
    val entries: List<Entry>,
) {
    data class Entry(
        val id: String,
        val version: Int,
        val config: Map<String, Any?>,
    ) {
        val qualifiedId: String
            get() = "$id@$version"
    }

    companion object {
        const val ASSET_NAME = "native-companion.json"
        const val SUPPORTED_VERSION = 1

        fun load(context: Context): NativeCompanionConfig =
            context.assets.open(ASSET_NAME).bufferedReader().use { parse(it.readText()) }

        fun parse(json: String): NativeCompanionConfig {
            val root = try {
                JSONObject(json)
            } catch (error: JSONException) {
                throw NativeCapabilityCompositionException(
                    "Invalid $ASSET_NAME: ${error.message}",
                    error,
                )
            }

            val version = root.optInt("version", -1)
            if (version != SUPPORTED_VERSION) {
                throw NativeCapabilityCompositionException(
                    "Unsupported $ASSET_NAME version: $version"
                )
            }

            val capabilities = root.optJSONArray("capabilities")
                ?: throw NativeCapabilityCompositionException(
                    "$ASSET_NAME must declare a capabilities array"
                )

            val entries = ArrayList<Entry>(capabilities.length())
            val seen = HashSet<String>()
            for (index in 0 until capabilities.length()) {
                val entry = parseEntry(capabilities.optJSONObject(index), index)
                if (!seen.add(entry.qualifiedId)) {
                    throw NativeCapabilityCompositionException(
                        "Duplicate capability in $ASSET_NAME: ${entry.qualifiedId}"
                    )
                }
                entries.add(entry)
            }
            return NativeCompanionConfig(version, entries)
        }

        private fun parseEntry(value: JSONObject?, index: Int): Entry {
            val entry = value ?: throw NativeCapabilityCompositionException(
                "$ASSET_NAME capability entry $index must be an object"
            )
            val reference = entry.optString("id", "")
            if (reference.isBlank()) {
                throw NativeCapabilityCompositionException(
                    "$ASSET_NAME capability entry $index is missing id"
                )
            }
            val (id, version) = try {
                parseCapabilityReference(reference)
            } catch (_: UnknownNativeCapabilityException) {
                throw NativeCapabilityCompositionException(
                    "Invalid capability id in $ASSET_NAME: $reference"
                )
            }
            if (version == null) {
                throw NativeCapabilityCompositionException(
                    "Capability id in $ASSET_NAME must be versioned: $reference"
                )
            }

            val config = when (val parsed = entry.opt("config")) {
                null, JSONObject.NULL -> emptyMap()
                is JSONObject -> jsonValueToKotlin(parsed) as Map<String, Any?>
                else -> throw NativeCapabilityCompositionException(
                    "Capability config in $ASSET_NAME must be an object: $reference"
                )
            }
            return Entry(id, version, config)
        }
    }
}

/**
 * Typed access to auditable composition config values.
 *
 * Public because a capability module validates the config that the composition
 * hands it.
 */
fun Map<String, Any?>.requiredString(key: String): String =
    this[key] as? String ?: throw NativeCapabilityCompositionException(
        "Native companion config requires a string '$key'"
    )

fun Map<String, Any?>.requiredInt(key: String): Int = when (val value = this[key]) {
    is Int -> value
    is Number -> value.toInt()
    else -> throw NativeCapabilityCompositionException(
        "Native companion config requires an integer '$key'"
    )
}
