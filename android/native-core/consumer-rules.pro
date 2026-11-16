# Composition classes are selected by auditable class name at runtime, so R8 must
# keep both the class and its singleton/constructor entry point.
-keep class * implements me.uwen.orahako.nativebridge.NativeCompositionProvider {
    public static <fields>;
    <init>(...);
}

# Optional composition modules (for example widget companions) are listed by
# class name in generated build metadata and instantiated reflectively.
-keep class * implements me.uwen.orahako.nativebridge.NativeCapabilityCompositionModule {
    public static <fields>;
    <init>(...);
}
