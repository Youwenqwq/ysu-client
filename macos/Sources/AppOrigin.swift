import Foundation

/// One stable, app-owned origin for the bundled UI and its native bridge.
enum AppOrigin {
    static let host = "127.0.0.1"
    static let port: UInt16 = 17346
    static let url = URL(string: "http://127.0.0.1:17346/")!
    static let authority = "127.0.0.1:17346"

    static func contains(_ url: URL?) -> Bool {
        guard let url, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return false
        }
        return parts.scheme?.lowercased() == "http"
            && parts.host == host
            && parts.port == Int(port)
            && parts.user == nil
            && parts.password == nil
    }
}
