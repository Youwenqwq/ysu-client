package me.uwen.orahako.nativebridge

import com.getcapacitor.annotation.CapacitorPlugin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The core owns no concrete runtime permission: capabilities request the
 * permissions they need through the generic host hook, so a new Android
 * permission never requires editing the bridge or its annotation.
 */
class NativePermissionOwnershipTest {

    @Test
    fun bridgeDeclaresNoPermissionAliases() {
        val annotation = requireNotNull(
            OrahakoNativePlugin::class.java.getAnnotation(CapacitorPlugin::class.java),
        )
        assertEquals(0, annotation.permissions.size)
    }

    @Test
    fun hostRequestsPermissionsByAndroidPermissionName() {
        val methods = NativeCapabilityHost::class.java.methods

        assertTrue(
            methods.any { method ->
                method.name == "requestPermissions" &&
                    method.parameterTypes.firstOrNull() == Array<String>::class.java
            },
        )
        assertFalse(methods.any { it.name == "requestPermission" })
    }
}
