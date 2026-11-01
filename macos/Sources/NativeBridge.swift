import Foundation
import WebKit

/// The only privileged interface. The loopback HTTP listener has no credential/API routes.
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply, URLSessionTaskDelegate {
    static let handlerName = "ysuNative"
    private let storageURL: URL
    private let allowedHosts: Set<String>
    weak var webView: WKWebView?
    private var stopped = false
    private var session: URLSession!

    init(allowlistURL: URL) throws {
        guard let service = Bundle.main.bundleIdentifier, !service.isEmpty else {
            throw BridgeError.missingBundleIdentity
        }
        let data = try Data(contentsOf: allowlistURL)
        let hosts = try JSONDecoder().decode([String].self, from: data)
        guard !hosts.isEmpty, hosts.allSatisfy({ host in
            !host.isEmpty && host == host.lowercased()
                && host.utf8.allSatisfy({ (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 46 })
                && !host.hasPrefix(".") && !host.hasSuffix(".")
        }) else { throw BridgeError.invalidAllowlist }
        self.allowedHosts = Set(hosts)
        // 本地签名拿不到稳定的 Keychain ACL，凭据改存 0600 文件。
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        self.storageURL = support
            .appendingPathComponent(service, isDirectory: true)
            .appendingPathComponent("secure-store.json", isDirectory: false)
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 120
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }

    func stop() {
        guard !stopped else { return }
        stopped = true
        session.invalidateAndCancel()
        webView = nil
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard !stopped,
              message.name == Self.handlerName,
              message.webView === webView,
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "http",
              message.frameInfo.securityOrigin.host == AppOrigin.host,
              message.frameInfo.securityOrigin.port == Int(AppOrigin.port),
              AppOrigin.contains(message.frameInfo.request.url),
              let body = message.body as? [String: Any],
              let operation = body["operation"] as? String,
              let payload = body["payload"] as? [String: Any] else {
            replyHandler(nil, "Native bridge access denied.")
            return
        }
        switch operation {
        case "http":
            performHTTP(payload, reply: replyHandler)
        case "storage.get", "storage.set", "storage.remove":
            performStorage(operation, payload: payload, reply: replyHandler)
        case "notify.permission", "notify.requestPermission",
             "notify.scheduleClassAlarms", "notify.cancelClassAlarms":
            NotifyBridge.shared.handle(operation, payload: payload, reply: replyHandler)
        case "status.setClasses":
            guard let raw = payload["classes"] as? [[String: Any]] else {
                replyHandler(nil, "Invalid status bar classes.")
                return
            }
            if let error = StatusBarController.shared.setClasses(raw) {
                replyHandler(nil, error)
            } else {
                replyHandler(["updated": raw.count], nil)
            }
        case "status.clear":
            StatusBarController.shared.clear()
            replyHandler([String: Any](), nil)
        default:
            replyHandler(nil, "Unsupported native operation.")
        }
    }

    private func performHTTP(_ payload: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard let rawURL = payload["url"] as? String,
              let parts = URLComponents(string: rawURL),
              let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = parts.host?.lowercased(), allowedHosts.contains(host),
              parts.user == nil, parts.password == nil,
              parts.port == nil || parts.port == (scheme == "https" ? 443 : 80),
              let url = parts.url, url.host?.lowercased() == host,
              let method = payload["method"] as? String, method == "GET" || method == "POST",
              let headers = payload["headers"] as? [String: String] else {
            reply(nil, "Invalid or disallowed HTTP request.")
            return
        }
        var timeout: TimeInterval = 30
        if let value = payload["timeoutMs"] {
            guard let number = value as? NSNumber,
                  CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue.isFinite, number.doubleValue > 0,
                  number.doubleValue <= 120_000 else {
                reply(nil, "Invalid HTTP timeout.")
                return
            }
            timeout = number.doubleValue / 1000
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        var headerNames = Set<String>()
        for (name, value) in headers {
            let lower = name.lowercased()
            guard !name.isEmpty,
                  name.utf8.allSatisfy({ Self.headerToken.contains($0) }),
                  !Self.forbiddenHeaders.contains(lower), headerNames.insert(lower).inserted,
                  !value.unicodeScalars.contains(where: { $0.value < 32 && $0.value != 9 || $0.value == 127 }) else {
                reply(nil, "Invalid HTTP headers.")
                return
            }
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let encoded = payload["bodyBase64"] {
            guard let text = encoded as? String, let data = Data(base64Encoded: text) else {
                reply(nil, "Invalid HTTP body encoding.")
                return
            }
            request.httpBody = data
        }
        // URLSession follows the system's trust and proxy policy. The delegate only disables redirects.
        session.dataTask(with: request) { [weak self] data, response, error in
            guard let self, !self.stopped else {
                reply(nil, "Native transport stopped.")
                return
            }
            if let error = error as NSError? {
                // Do not expose localized errors, which can contain request URLs or other sensitive details.
                reply(nil, "HTTP transport failed (code \(error.code)).")
                return
            }
            guard let response = response as? HTTPURLResponse,
                  let responseURL = response.url else {
                reply(nil, "HTTP transport returned no response.")
                return
            }
            var responseHeaders: [String: Any] = [:]
            for (key, value) in response.allHeaderFields {
                let name = String(describing: key).lowercased()
                if let values = value as? [String] {
                    responseHeaders[name] = values
                } else if let value = value as? String {
                    // In particular, retain Set-Cookie verbatim; the JS cookie jar owns parsing/storage.
                    responseHeaders[name] = value
                } else {
                    responseHeaders[name] = String(describing: value)
                }
            }
            reply([
                "status": response.statusCode,
                "headers": responseHeaders,
                "url": responseURL.absoluteString,
                "bodyBase64": (data ?? Data()).base64EncodedString(),
            ], nil)
        }.resume()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // All redirect decisions and cookies remain in the existing frontend transport.
        completionHandler(nil)
    }

    private func readStore() throws -> [String: String] {
        guard FileManager.default.fileExists(atPath: storageURL.path) else { return [:] }
        let data = try Data(contentsOf: storageURL)
        guard !data.isEmpty else { return [:] }
        return try JSONDecoder().decode([String: String].self, from: data)
    }

    private func writeStore(_ store: [String: String]) throws {
        let directory = storageURL.deletingLastPathComponent()
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true,
                                        attributes: [.posixPermissions: 0o700])
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        let data = try JSONEncoder().encode(store)
        try data.write(to: storageURL, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: storageURL.path)
    }

    private func performStorage(_ operation: String, payload: [String: Any], reply: (Any?, String?) -> Void) {
        guard let name = payload["name"] as? String, !name.isEmpty else {
            reply(nil, "Invalid storage item name.")
            return
        }
        do {
            var store = try readStore()
            switch operation {
            case "storage.get":
                if let value = store[name] {
                    reply(["value": value], nil)
                } else {
                    reply(["value": NSNull()], nil)
                }
            case "storage.set":
                guard let value = payload["value"] as? String else {
                    reply(nil, "Invalid storage item value.")
                    return
                }
                store[name] = value
                try writeStore(store)
                reply([String: Any](), nil)
            case "storage.remove":
                store.removeValue(forKey: name)
                try writeStore(store)
                reply([String: Any](), nil)
            default:
                reply(nil, "Unsupported storage operation.")
            }
        } catch {
            NSLog("YSU storage %@ failed for %@: %@", operation, name, String(describing: error))
            reply(nil, "Local storage operation failed.")
        }
    }

    private static let headerToken = Set("!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".utf8)

    enum BridgeError: Error {
        case invalidAllowlist
        case missingBundleIdentity
    }
    private static let forbiddenHeaders = Set(["host", "content-length", "connection", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-connection", "te", "trailer"])
}
