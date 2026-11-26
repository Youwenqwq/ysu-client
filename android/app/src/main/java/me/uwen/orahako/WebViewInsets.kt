package me.uwen.orahako

import android.os.Build
import android.view.View
import android.webkit.WebView
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.Bridge
import com.getcapacitor.WebViewListener
import java.util.Locale

/**
 * Owns the WebView container's window insets from the first layout pass.
 *
 * Capacitor's `SystemBars` only learns that the page declares `viewport-fit=cover`
 * after `DOMContentLoaded`, so the first frames are laid out inside system-bar
 * padding and the viewport then grows to full screen, visibly shifting the boot
 * splash. The static root layout always declares `viewport-fit=cover`, so the
 * passthrough decision depends only on the WebView version and is fixed at startup.
 *
 * The behaviour otherwise mirrors `com.getcapacitor.plugin.SystemBars` (8.3):
 * review it together with that file when upgrading Capacitor.
 */
internal object WebViewInsets {
    // https://issues.chromium.org/issues/40699457
    private const val WEBVIEW_SAFE_AREA_FIX = 140

    // https://issues.chromium.org/issues/457682720
    private const val WEBVIEW_SAFE_AREA_KEYBOARD_FIX = 144

    private val SAFE_AREA_TYPES =
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()

    @JvmStatic
    fun install(bridge: Bridge) {
        val webView = bridge.webView
        val container = webView.parent as View
        val webViewMajor = webViewMajorVersion()
        val passthrough = webViewMajor >= WEBVIEW_SAFE_AREA_FIX
        val injectsCss = Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM

        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val bars = insets.getInsets(SAFE_AREA_TYPES)
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime())

            val result =
                if (passthrough) {
                    view.setPadding(0, 0, 0, if (keyboardVisible) ime.bottom else 0)
                    val bottom =
                        if (keyboardVisible && webViewMajor < WEBVIEW_SAFE_AREA_KEYBOARD_FIX) 0
                        else bars.bottom
                    WindowInsetsCompat.Builder(insets)
                        .setInsets(SAFE_AREA_TYPES, Insets.of(bars.left, bars.top, bars.right, bottom))
                        .build()
                } else {
                    if (injectsCss) {
                        view.setPadding(
                            bars.left,
                            bars.top,
                            bars.right,
                            if (keyboardVisible) ime.bottom else bars.bottom,
                        )
                    }
                    // Returning CONSUMED breaks later safe-area recalculation in Chromium;
                    // zero the consumed types explicitly instead.
                    WindowInsetsCompat.Builder(insets).setInsets(SAFE_AREA_TYPES, Insets.NONE).build()
                }

            if (injectsCss) injectSafeAreaCss(webView, safeArea(result))
            result
        }

        // Variables injected before the document exists are lost; re-dispatch once it commits.
        bridge.addWebViewListener(
            object : WebViewListener() {
                override fun onPageCommitVisible(view: WebView, url: String) {
                    container.requestApplyInsets()
                }
            },
        )
        container.requestApplyInsets()
    }

    private fun safeArea(insets: WindowInsetsCompat): Insets {
        val area = insets.getInsets(SAFE_AREA_TYPES)
        return if (insets.isVisible(WindowInsetsCompat.Type.ime())) {
            Insets.of(area.left, area.top, area.right, 0)
        } else {
            area
        }
    }

    private fun injectSafeAreaCss(webView: WebView, area: Insets) {
        val density = webView.resources.displayMetrics.density
        fun dp(px: Int) = (px / density).toInt()
        val script =
            String.format(
                Locale.US,
                """
                try {
                  const style = document.documentElement.style;
                  style.setProperty("--safe-area-inset-top", "%dpx");
                  style.setProperty("--safe-area-inset-right", "%dpx");
                  style.setProperty("--safe-area-inset-bottom", "%dpx");
                  style.setProperty("--safe-area-inset-left", "%dpx");
                } catch (e) { console.error("Error injecting safe area CSS:", e); }
                """.trimIndent(),
                dp(area.top),
                dp(area.right),
                dp(area.bottom),
                dp(area.left),
            )
        webView.evaluateJavascript(script, null)
    }

    private fun webViewMajorVersion(): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return 0
        val versionName = WebView.getCurrentWebViewPackage()?.versionName ?: return 0
        return versionName.substringBefore('.').toIntOrNull() ?: 0
    }
}
