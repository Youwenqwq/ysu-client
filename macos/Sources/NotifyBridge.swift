import CryptoKit
import Foundation
import UserNotifications

/// macOS 本地上课提醒；网页只传最终标题、正文和触发时间。
final class NotifyBridge: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotifyBridge()

    private let center = UNUserNotificationCenter.current()
    private let prefix = "class-alarm:"
    private let maxIdentityLength = 256
    private let maxTitleLength = 200
    private let maxBodyLength = 500
    private let maxAlarms = 500
    private let queue = DispatchQueue(label: "com.youwenqwq.ysuclient.notify")

    func install() {
        center.delegate = self
    }

    func handle(_ operation: String, payload: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        switch operation {
        case "notify.permission":
            permission(reply: reply)
        case "notify.requestPermission":
            requestPermission(reply: reply)
        case "notify.scheduleClassAlarms":
            schedule(payload, reply: reply)
        case "notify.cancelClassAlarms":
            cancel(reply: reply)
        default:
            reply(nil, "Unsupported notification operation.")
        }
    }

    // MARK: - Permission

    private func permission(reply: @escaping (Any?, String?) -> Void) {
        center.getNotificationSettings { settings in
            let status = settings.authorizationStatus
            DispatchQueue.main.async {
                reply([
                    "granted": status == .authorized || status == .provisional,
                    "status": Self.statusName(status),
                ], nil)
            }
        }
    }

    private func requestPermission(reply: @escaping (Any?, String?) -> Void) {
        center.requestAuthorization(options: [.alert, .sound]) { _, error in
            guard error == nil else {
                DispatchQueue.main.async { reply(nil, "Notification permission request failed.") }
                return
            }
            self.permission(reply: reply)
        }
    }

    private static func statusName(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        @unknown default: return "unknown"
        }
    }

    // MARK: - Scheduling

    private struct Alarm {
        let identifier: String
        let title: String
        let body: String
        let date: Date
    }

    private func schedule(_ payload: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard let raw = payload["alarms"] as? [[String: Any]] else {
            reply(nil, "Invalid class alarms.")
            return
        }
        guard raw.count <= maxAlarms else {
            reply(nil, "Too many class alarms.")
            return
        }
        let now = Date()
        var alarms: [Alarm] = []
        var seen = Set<String>()
        for item in raw {
            guard let id = item["id"] as? String, !id.isEmpty, id.utf8.count <= maxIdentityLength,
                  let title = item["title"] as? String, !title.isEmpty, title.count <= maxTitleLength,
                  let body = item["body"] as? String, body.count <= maxBodyLength,
                  let time = item["timeMs"] as? NSNumber,
                  CFGetTypeID(time) != CFBooleanGetTypeID(),
                  time.doubleValue.isFinite, time.doubleValue > 0 else {
                reply(nil, "Invalid class alarm.")
                return
            }
            let date = Date(timeIntervalSince1970: time.doubleValue / 1000)
            guard date > now else { continue }
            guard seen.insert(id).inserted else {
                reply(nil, "Duplicate class alarm.")
                return
            }
            alarms.append(Alarm(identifier: identifier(for: id), title: title, body: body, date: date))
        }

        queue.async {
            self.removeClassAlarms {
                let requests = alarms.map { alarm -> UNNotificationRequest in
                    let content = UNMutableNotificationContent()
                    content.title = alarm.title
                    content.body = alarm.body
                    content.sound = .default
                    let interval = max(1, alarm.date.timeIntervalSinceNow)
                    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
                    return UNNotificationRequest(identifier: alarm.identifier, content: content, trigger: trigger)
                }
                guard !requests.isEmpty else {
                    DispatchQueue.main.async { reply(["scheduled": 0], nil) }
                    return
                }
                let group = DispatchGroup()
                let failureLock = NSLock()
                var failed = false
                for request in requests {
                    group.enter()
                    self.center.add(request) { error in
                        if error != nil {
                            failureLock.lock()
                            failed = true
                            failureLock.unlock()
                        }
                        group.leave()
                    }
                }
                group.notify(queue: .main) {
                    if failed {
                        reply(nil, "Scheduling class alarms failed.")
                    } else {
                        reply(["scheduled": requests.count], nil)
                    }
                }
            }
        }
    }

    private func cancel(reply: @escaping (Any?, String?) -> Void) {
        queue.async {
            self.removeClassAlarms {
                DispatchQueue.main.async { reply([String: Any](), nil) }
            }
        }
    }

    private func removeClassAlarms(_ completion: @escaping () -> Void) {
        center.getPendingNotificationRequests { pending in
            let identifiers = pending.map { $0.identifier }.filter { $0.hasPrefix(self.prefix) }
            if !identifiers.isEmpty {
                self.center.removePendingNotificationRequests(withIdentifiers: identifiers)
            }
            completion()
        }
    }

    /// Stable, bounded identifier; the raw timetable key can be long and contain CJK.
    private func identifier(for key: String) -> String {
        let digest = SHA256.hash(data: Data(key.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return prefix + hex.prefix(32)
    }

    // MARK: - Foreground presentation

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }
}
