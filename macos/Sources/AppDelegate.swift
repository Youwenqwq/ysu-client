import AppKit
import UniformTypeIdentifiers
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private(set) var webView: WKWebView?
    private var window: NSWindow?
    private var server: StaticAssetServer?
    private var bridge: NativeBridge?
    private var terminating = false
    private var displayingFailure = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.regular)
        NotifyBridge.shared.install()
        installMenus()
        do {
            guard let resources = Bundle.main.resourceURL else { throw LaunchError.missingResources }
            let server = try StaticAssetServer(root: resources.appendingPathComponent("Web", isDirectory: true))
            let bridge = try NativeBridge(allowlistURL: resources.appendingPathComponent("native-allowed-hosts.json"))
            self.server = server
            self.bridge = bridge
            createWindow(bridge: bridge)
            StatusBarController.shared.install(appearanceProvider: { [weak self] completion in
                guard let self, let webView = self.webView else {
                    completion(NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua)
                    return
                }
                webView.evaluateJavaScript("""
                (() => {
                  const el = document.documentElement;
                  return el.classList.contains('dark') ||
                    getComputedStyle(el).colorScheme.includes('dark');
                })()
                """) { value, _ in
                    if let number = value as? NSNumber {
                        completion(number.boolValue)
                    } else if let dark = value as? Bool {
                        completion(dark)
                    } else {
                        completion(NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua)
                    }
                }
            })
            try server.start(onReady: { [weak self] in
                guard let self, !self.terminating else { return }
                // Do not load anything until our own, exclusively bound listener reports ready.
                self.webView?.load(URLRequest(url: AppOrigin.url))
            }, onFailure: { [weak self] in
                self?.fail("无法启动本地资源服务", detail: "端口 17346 可能已被占用，或本地资源服务已停止。请关闭其他燕大终端实例后重新打开；应用不会连接已有的未知服务。")
            })
        } catch {
            fail("无法启动燕大终端", detail: "应用资源或网络配置不完整，或本地端口 17346 无法绑定。请重新安装完整的应用后再试。")
        }
    }

    private func createWindow(bridge: NativeBridge) {
        let controller = WKUserContentController()
        controller.addScriptMessageHandler(bridge, contentWorld: .page, name: NativeBridge.handlerName)
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        if let cssURL = Bundle.main.url(forResource: "glass", withExtension: "css"),
           let css = try? String(contentsOf: cssURL, encoding: .utf8),
           let cssData = try? JSONEncoder().encode(css),
           let cssLiteral = String(data: cssData, encoding: .utf8) {
            controller.addUserScript(WKUserScript(
                source: """
                document.documentElement.classList.add('macos-glass');
                const glassStyle = document.createElement('style');
                glassStyle.id = 'macos-glass-style';
                glassStyle.textContent = \(cssLiteral);
                document.documentElement.appendChild(glassStyle);
                """,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            ))
        }
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = false
        bridge.webView = webView
        self.webView = webView

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "燕大终端"
        window.minSize = NSSize(width: 760, height: 560)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = webView

        window.setFrameAutosaveName("YSUClientMainWindow")
        window.center()
        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    /// The menu-bar item stays useful after the window closes; Quit is explicit.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        shutdown()
        return .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        shutdown()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard !terminating else { return false }
        window?.makeKeyAndOrderFront(nil)
        return true
    }

    private func shutdown() {
        guard !terminating else { return }
        terminating = true
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: NativeBridge.handlerName, contentWorld: .page)
        bridge?.stop()
        bridge = nil
        server?.stop()
        server = nil
        webView = nil
        window?.delegate = nil
        window?.contentView = nil
        window = nil
    }

    private func fail(_ title: String, detail: String) {
        guard !terminating, !displayingFailure else { return }
        displayingFailure = true
        webView?.stopLoading()
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = title
        alert.informativeText = detail
        alert.addButton(withTitle: "退出")
        alert.runModal()
        NSApplication.shared.terminate(nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        if AppOrigin.contains(url) {
            decisionHandler(.allow)
            return
        }
        // Script-created windows require a user gesture because automatic window opening is disabled.
        let userOpenedWindow = navigationAction.targetFrame == nil && AppOrigin.contains(navigationAction.sourceFrame.request.url)
        if navigationAction.navigationType == .linkActivated || userOpenedWindow,
           let url, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(AppOrigin.contains(navigationResponse.response.url) && navigationResponse.canShowMIMEType ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if AppOrigin.contains(navigationAction.request.url) {
            webView.load(navigationAction.request)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled,
              !(nsError.domain == "WebKitErrorDomain" && nsError.code == 102) else { return }
        fail("无法载入应用界面", detail: "内置资源无法从本地资源服务载入。请退出后重新打开完整的应用。")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard !terminating else { return }
        fail("应用页面进程已停止", detail: "请退出后重新打开燕大终端。")
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        guard AppOrigin.contains(frame.request.url), let window else {
            completionHandler(nil)
            return
        }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.image]
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard frame.isMainFrame, AppOrigin.contains(frame.request.url) else { completionHandler(); return }
        let alert = NSAlert()
        alert.messageText = "燕大终端"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        if let window {
            alert.beginSheetModal(for: window) { _ in completionHandler() }
        } else {
            completionHandler()
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard frame.isMainFrame, AppOrigin.contains(frame.request.url), let window else { completionHandler(false); return }
        let alert = NSAlert()
        alert.messageText = "燕大终端"
        alert.informativeText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        guard frame.isMainFrame, AppOrigin.contains(frame.request.url), let window else { completionHandler(nil); return }
        let alert = NSAlert()
        alert.messageText = "燕大终端"
        alert.informativeText = prompt
        let field = NSTextField(string: defaultText ?? "")
        field.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
        alert.accessoryView = field
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }

    private func installMenus() {
        let main = NSMenu()
        let app = NSMenu(title: "燕大终端")
        app.addItem(withTitle: "关于燕大终端", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        let services = NSMenu(title: "服务")
        let servicesItem = app.addItem(withTitle: "服务", action: nil, keyEquivalent: "")
        servicesItem.submenu = services
        NSApplication.shared.servicesMenu = services
        app.addItem(.separator())
        app.addItem(withTitle: "隐藏燕大终端", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = app.addItem(withTitle: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: "显示全部", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "退出燕大终端", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        addMenu(app, to: main)

        let file = NSMenu(title: "文件")
        file.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        addMenu(file, to: main)

        let edit = NSMenu(title: "编辑")
        edit.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        addMenu(edit, to: main)

        let view = NSMenu(title: "显示")
        let reload = view.addItem(withTitle: "重新载入", action: #selector(reloadPage(_:)), keyEquivalent: "r")
        reload.target = self
        let back = view.addItem(withTitle: "后退", action: #selector(goBack(_:)), keyEquivalent: "[")
        back.target = self
        let forward = view.addItem(withTitle: "前进", action: #selector(goForward(_:)), keyEquivalent: "]")
        forward.target = self
        view.addItem(.separator())
        let fullscreen = view.addItem(withTitle: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullscreen.keyEquivalentModifierMask = [.command, .control]
        addMenu(view, to: main)

        let windows = NSMenu(title: "窗口")
        windows.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windows.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windows.addItem(.separator())
        windows.addItem(withTitle: "前置全部窗口", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        addMenu(windows, to: main)
        NSApplication.shared.windowsMenu = windows
        NSApplication.shared.mainMenu = main
    }

    private func addMenu(_ menu: NSMenu, to main: NSMenu) {
        let item = NSMenuItem(title: menu.title, action: nil, keyEquivalent: "")
        item.submenu = menu
        main.addItem(item)
    }

    @objc private func reloadPage(_ sender: Any?) { webView?.reload() }
    @objc private func goBack(_ sender: Any?) { if webView?.canGoBack == true { webView?.goBack() } }
    @objc private func goForward(_ sender: Any?) { if webView?.canGoForward == true { webView?.goForward() } }

    private enum LaunchError: Error { case missingResources }
}
