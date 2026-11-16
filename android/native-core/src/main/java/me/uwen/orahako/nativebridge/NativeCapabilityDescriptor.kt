package me.uwen.orahako.nativebridge

/** Serialisable description of one enabled capability. */
data class NativeCapabilityDescriptor(
    val id: String,
    val version: Int,
    val methods: List<String>,
    val dependencies: List<String>,
    val config: Map<String, Any?>,
) {
    val qualifiedId: String
        get() = "$id@$version"
}
