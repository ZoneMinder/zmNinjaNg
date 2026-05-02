# R8/ProGuard rules for the zmNinjaNG release build.
#
# @capacitor/android ships consumer proguard rules that keep subclasses of
# com.getcapacitor.Plugin and @CapacitorPlugin-annotated members. Modern
# AndroidX, Media3, Firebase, and ML Kit AARs bundle their own consumer
# rules as well. This file covers app-level attributes and edge cases not
# handled by transitive AAR rules.

# Preserve stack trace metadata so mapping.txt deobfuscates Play Console
# crash reports.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Annotations are read reflectively by Capacitor's plugin bridge, AndroidX,
# Firebase, and JSON libraries. Generic signatures and inner-class metadata
# are needed for some reflection paths (e.g. parameterized type tokens).
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses,EnclosingMethod

# Any class exposed to a WebView via @JavascriptInterface must keep its
# annotated methods reachable.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
