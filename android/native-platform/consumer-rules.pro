# QuickJS JNI looks up Kotlin/Java types by class name (including kotlin.Unit
# and binding types), so R8 must not rename or strip them in release builds.
-keep class com.dokar.quickjs.** { *; }
-keepclassmembers class com.dokar.quickjs.** { *; }
-keep class kotlin.Unit { *; }
