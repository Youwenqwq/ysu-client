# === Capacitor Core ===
# Keep all Capacitor classes and members (bridge, config, plugin infrastructure)
-keep class com.getcapacitor.** { *; }
-keepclassmembers class com.getcapacitor.** { *; }

# Keep all Plugin subclasses and their annotated methods (registered via reflection)
-keep public class * extends com.getcapacitor.Plugin {
    public <methods>;
    public <fields>;
}
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PluginMethod <methods>;
}
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.annotation.PluginMethod <methods>;
}

# Keep Capacitor plugin result / call classes used across the bridge
-keep class com.getcapacitor.PluginCall { *; }
-keep class com.getcapacitor.PluginResult { *; }
-keep class com.getcapacitor.JSObject { *; }
-keep class com.getcapacitor.JSArray { *; }

# === Capacitor Community Plugins ===
-keep class com.capacitorcommunity.** { *; }
-keepclassmembers class com.capacitorcommunity.** { *; }

# === Capacitor Official Plugins ===
-keep class com.capacitorjs.plugins.** { *; }
-keepclassmembers class com.capacitorjs.plugins.** { *; }

# === Third-party Capacitor Plugins (aparajita, capgo, etc.) ===
-keep class com.aparajita.** { *; }
-keepclassmembers class com.aparajita.** { *; }
-keep class capgo.** { *; }
-keepclassmembers class capgo.** { *; }
-keep class ee.forgr.** { *; }
-keepclassmembers class ee.forgr.** { *; }

# === App-specific plugins ===
-keep class me.uwen.orahako.** { *; }
-keepclassmembers class me.uwen.orahako.** { *; }

# === Kotlin ===
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations
-keep class kotlin.Metadata { *; }
-keepclassmembers class * {
    @kotlin.Metadata *;
}
-keepclassmembers class *$Companion {
    *;
}
-keep class *$Companion { *; }

# === WebView / JS Interface ===
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# === Native methods ===
-keepclasseswithmembernames class * {
    native <methods>;
}

# === Google Play Services (used by capgo-updater) ===
-keep class com.google.android.gms.** { *; }
-keepclassmembers class com.google.android.gms.** { *; }
-keep class com.google.android.play.** { *; }
-keepclassmembers class com.google.android.play.** { *; }

# === AndroidX / Material ===
-keep class androidx.appcompat.** { *; }
-keep class androidx.core.** { *; }
-keep class androidx.fragment.** { *; }
-keep class androidx.activity.** { *; }
-keep class androidx.coordinatorlayout.** { *; }
-keep class androidx.core.splashscreen.** { *; }
-keep class com.google.android.material.** { *; }

# === Networking (OkHttp used by CapacitorHttp) ===
-keep class okhttp3.** { *; }
-keepclassmembers class okhttp3.** { *; }
-keep class okio.** { *; }

# === Preserve line numbers for release stack traces ===
-keepattributes SourceFile,LineNumberTable
