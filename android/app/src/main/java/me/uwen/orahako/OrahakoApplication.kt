package me.uwen.orahako

import android.app.Application
import me.uwen.orahako.nativebridge.NativeComposition

/**
 * Process bootstrap for the native capability composition.
 *
 * Installs the build-selected composition before the bridge is created and
 * before WorkManager can run scheduled work in a fresh process. The composition
 * provider class comes from generated build configuration, so the app source
 * never imports an official or school-specific composition; a missing or empty
 * provider fails loudly.
 */
class OrahakoApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        NativeComposition.installFromProvider(BuildConfig.NATIVE_COMPOSITION_PROVIDER)
        NativeComposition.initialize(this)
    }
}
