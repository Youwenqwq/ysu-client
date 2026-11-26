package me.uwen.orahako.nativebridge.capabilities

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.TypedValue
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import me.uwen.orahako.nativebridge.NativeCapability
import me.uwen.orahako.nativebridge.NativeCapabilityBinding
import me.uwen.orahako.nativebridge.NativeCapabilityCompositionException
import me.uwen.orahako.nativebridge.NativeCapabilityHost
import me.uwen.orahako.nativebridge.NativeInvokeResult
import me.uwen.orahako.nativebridge.requiredInt
import me.uwen.orahako.nativebridge.requiredString

/**
 * WebView version advisory and safe-area inset correction.
 *
 * The advisory link and version thresholds are official composition choices;
 * only generic WebView mechanics live here.
 */
class WebViewCapability(
    private val host: NativeCapabilityHost,
    override val config: Map<String, Any?>,
) : NativeCapability {

    override val id: String = ID
    override val version: Int = 1
    override val methods: Set<String> = setOf("check", "initSafeArea")

    private val faqUrl: String = config.requiredString("faqUrl")
    private val minimumVersion: Int = config.requiredInt("minimumVersion")
    private val fullVersion: Int = config.requiredInt("fullVersion")

    init {
        if (minimumVersion > fullVersion) {
            throw NativeCapabilityCompositionException(
                "webview capability requires minimumVersion <= fullVersion"
            )
        }
    }

    override fun bind(): NativeCapabilityBinding = Binding()

    private inner class Binding : NativeCapabilityBinding {
        override fun invoke(
            method: String,
            payload: Map<String, Any?>,
            result: NativeInvokeResult,
        ) {
            when (method) {
                "check" -> check(payload, result)
                "initSafeArea" -> initSafeArea(result)
            }
        }

        override fun release() = Unit
    }

    private fun check(payload: Map<String, Any?>, result: NativeInvokeResult) {
        val context = host.context
        val version = getWebViewMajorVersion(context)

        if (version != null && version >= fullVersion) {
            result.resolve(null)
            return
        }

        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        if (preferences.getBoolean(PREF_DISMISSED, false)) {
            result.resolve(null)
            return
        }

        val strings = when (payload["locale"] as? String) {
            "en" -> EnStrings
            else -> ZhStrings
        }
        val message = buildMessage(version, strings)
        showDialog(context, preferences, strings, message)
        result.resolve(null)
    }

    private fun initSafeArea(result: NativeInvokeResult) {
        val decorView = host.activity?.window?.decorView
        val insets = decorView?.let { ViewCompat.getRootWindowInsets(it) }

        if (insets != null) {
            val systemBars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
            val density = host.context.resources.displayMetrics.density

            val top = (systemBars.top / density).toInt()
            val right = (systemBars.right / density).toInt()
            val bottom = if (keyboardVisible) 0 else (systemBars.bottom / density).toInt()
            val left = (systemBars.left / density).toInt()

            host.runOnUiThread {
                host.evaluateJavascript(
                    """
                    try {
                      var s = document.documentElement.style;
                      s.setProperty("--safe-area-inset-top", "${top}px");
                      s.setProperty("--safe-area-inset-right", "${right}px");
                      s.setProperty("--safe-area-inset-bottom", "${bottom}px");
                      s.setProperty("--safe-area-inset-left", "${left}px");
                    } catch(e) {}
                    """.trimIndent()
                )
            }
        }

        result.resolve(null)
    }

    private fun getWebViewMajorVersion(context: Context): Int? {
        for (packageName in WEBVIEW_PACKAGES) {
            try {
                val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    context.packageManager.getPackageInfo(
                        packageName,
                        PackageManager.PackageInfoFlags.of(0),
                    )
                } else {
                    @Suppress("DEPRECATION")
                    context.packageManager.getPackageInfo(packageName, 0)
                }
                return parseMajorVersion(info.versionName)
            } catch (_: PackageManager.NameNotFoundException) {
                continue
            }
        }
        return null
    }

    private fun parseMajorVersion(versionName: String?): Int? {
        if (versionName.isNullOrBlank()) return null
        return versionName.split(".").firstOrNull()?.toIntOrNull()
    }

    private fun buildMessage(version: Int?, strings: DialogStrings): String {
        val versionText = version?.toString() ?: strings.unknownVersion
        return when {
            version == null -> strings.unknownMessage
            version < minimumVersion -> strings.criticalMessage(versionText, minimumVersion)
            else -> strings.warningMessage(versionText, fullVersion)
        }
    }

    private fun showDialog(
        context: Context,
        preferences: SharedPreferences,
        strings: DialogStrings,
        message: String,
    ) {
        val density = context.resources.displayMetrics.density
        val paddingHorizontal = (24 * density).toInt()
        val paddingVertical = (20 * density).toInt()
        val gap = (16 * density).toInt()

        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(paddingHorizontal, paddingVertical, paddingHorizontal, paddingVertical)
        }

        val messageView = TextView(context).apply {
            text = message
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        }
        container.addView(messageView)

        val spacer = LinearLayout(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                gap,
            )
        }
        container.addView(spacer)

        val checkBox = CheckBox(context).apply {
            text = strings.doNotShowAgain
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        }
        container.addView(checkBox)

        host.runOnUiThread {
            MaterialAlertDialogBuilder(context)
                .setTitle(strings.title)
                .setView(container)
                .setPositiveButton(strings.help) { _, _ ->
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(faqUrl)))
                }
                .setNegativeButton(strings.dismiss) { _, _ ->
                    if (checkBox.isChecked) {
                        preferences.edit().putBoolean(PREF_DISMISSED, true).apply()
                    }
                }
                .setCancelable(false)
                .show()
        }
    }

    private interface DialogStrings {
        val title: String
        val help: String
        val dismiss: String
        val doNotShowAgain: String
        val unknownVersion: String
        val unknownMessage: String
        fun criticalMessage(version: String, minimum: Int): String
        fun warningMessage(version: String, recommended: Int): String
    }

    private object ZhStrings : DialogStrings {
        override val title = "WebView 兼容性提示"
        override val help = "查看帮助"
        override val dismiss = "忽略"
        override val doNotShowAgain = "不再提醒"
        override val unknownVersion = "未知"
        override val unknownMessage =
            "无法检测您的 WebView 版本，应用可能无法正常显示。\n\n建议更新 Android System WebView 以获得最佳体验。"
        override fun criticalMessage(version: String, minimum: Int) =
            "您当前的 WebView 版本（Chrome $version）过低，应用可能出现严重的样式错乱甚至无法渲染，强烈建议更新。\n\n最低兼容版本为 Chrome $minimum。"
        override fun warningMessage(version: String, recommended: Int) =
            "您当前的 WebView 版本（Chrome $version）较低，部分样式（如标题栏透明效果、卡片边框等）可能未正确渲染，但不影响正常使用。\n\n建议更新至 Chrome $recommended+ 以获得完整的视觉体验。"
    }

    private object EnStrings : DialogStrings {
        override val title = "WebView Compatibility Warning"
        override val help = "View Help"
        override val dismiss = "Dismiss"
        override val doNotShowAgain = "Don't ask again"
        override val unknownVersion = "unknown"
        override val unknownMessage =
            "Unable to detect your WebView version. The app may not display correctly.\n\nPlease update Android System WebView for the best experience."
        override fun criticalMessage(version: String, minimum: Int) =
            "Your WebView version (Chrome $version) is too low. The app may have severe style issues or fail to render. Please update.\n\nMinimum compatible version is Chrome $minimum."
        override fun warningMessage(version: String, recommended: Int) =
            "Your WebView version (Chrome $version) is lower than recommended. Some styles (e.g. title bar transparency, card borders) may not render correctly, but the app remains usable.\n\nPlease update to Chrome $recommended+ for the full visual experience."
    }

    companion object {
        const val ID = "native.webview"
        private const val PREF_NAME = "webview_compat"
        private const val PREF_DISMISSED = "dismissed"

        private val WEBVIEW_PACKAGES = listOf(
            "com.google.android.webview",
            "com.android.webview",
            "com.google.android.webview.beta",
            "com.google.android.webview.dev",
            "com.google.android.webview.canary",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary",
            "com.chrome",
        )
    }
}
