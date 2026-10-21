import AppKit
import Carbon.HIToolbox

/// 菜单栏显示下节/当前课程；课表由网页推送。
final class StatusBarController: NSObject {
    static let shared = StatusBarController()

    private struct ScheduledClass: Codable {
        let name: String
        let classroom: String
        let startsAt: Double
        let endsAt: Double
    }

    private let defaultsKey = "YSUClientStatusBarClasses"
    private let maxClasses = 100
    private let maxNameLength = 100
    private let maxRoomLength = 100
    private var classes: [ScheduledClass] = []
    private var statusItem: NSStatusItem?
    private var timer: Timer?
    private var appearanceProvider: ((@escaping (Bool) -> Void) -> Void)?
    private var popover: NSPopover?
    private var popoverController: StatusBarPopoverController?
    private var hotKey: GlobalHotKey?
    private var dismissMonitor: Any?
    private var resignObserver: NSObjectProtocol?
    private var closeObserver: NSObjectProtocol?

    func install(appearanceProvider: @escaping (@escaping (Bool) -> Void) -> Void) {
        guard statusItem == nil else { return }
        self.appearanceProvider = appearanceProvider
        classes = loadClasses()
        installPopover()

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.autosaveName = "YSUClientStatusItem"
        item.button?.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        item.button?.toolTip = "燕大终端 · ⌥⌘Y"
        statusItem = item
        if let button = item.button {
            button.target = self
            button.action = #selector(statusItemClicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        hotKey = GlobalHotKey(keyCode: UInt32(kVK_ANSI_Y),
                              modifiers: UInt32(cmdKey | optionKey)) { [weak self] in
            self?.togglePopover()
        }
        if hotKey == nil {
            NSLog("YSU hotkey registration failed")
        }

        refresh()
        let refreshTimer = Timer(timeInterval: 30, repeats: true) { [weak self] _ in
            self?.refresh()
        }
        RunLoop.main.add(refreshTimer, forMode: .common)
        timer = refreshTimer
    }

    private func installPopover() {
        let controller = StatusBarPopoverController()
        let popover = NSPopover()
        popover.behavior = .applicationDefined
        popover.animates = false
        popover.contentViewController = controller
        self.popover = popover
        self.popoverController = controller
    }

    // MARK: - Bridge input

    /// Returns a user-facing error message, or nil when accepted.
    func setClasses(_ raw: [[String: Any]]) -> String? {
        guard raw.count <= maxClasses else { return "Too many classes." }
        var parsed: [ScheduledClass] = []
        for entry in raw {
            guard let name = entry["name"] as? String, !name.isEmpty, name.count <= maxNameLength,
                  let classroom = entry["classroom"] as? String, classroom.count <= maxRoomLength,
                  let start = entry["startsAt"] as? NSNumber,
                  let end = entry["endsAt"] as? NSNumber,
                  CFGetTypeID(start) != CFBooleanGetTypeID(),
                  CFGetTypeID(end) != CFBooleanGetTypeID(),
                  start.doubleValue.isFinite, end.doubleValue.isFinite,
                  start.doubleValue > 0, end.doubleValue > start.doubleValue else {
                return "Invalid class entry."
            }
            parsed.append(ScheduledClass(name: name, classroom: classroom,
                                         startsAt: start.doubleValue, endsAt: end.doubleValue))
        }
        parsed.sort { $0.startsAt < $1.startsAt }
        classes = parsed
        persist()
        refresh()
        return nil
    }

    func clear() {
        classes = []
        UserDefaults.standard.removeObject(forKey: defaultsKey)
        refresh()
    }

    // MARK: - Rendering

    private func refresh() {
        guard let button = statusItem?.button else { return }
        let now = Date().timeIntervalSince1970 * 1000
        let live = classes.filter { $0.endsAt > now }.sorted { $0.startsAt < $1.startsAt }
        let ongoing = live.first { $0.startsAt <= now && $0.endsAt > now }
        let next = live.first { $0.startsAt > now }
        let agenda = agendaRows(now: now, ongoing: ongoing, next: next)

        if let ongoing {
            button.title = "上课中 \(shortName(ongoing.name))"
            button.toolTip = detail(ongoing, now: now, ongoing: true)
            popoverController?.update(kicker: "正在上课",
                                      headline: ongoing.name,
                                      detail: detail(ongoing, now: now, ongoing: true),
                                      footer: todayFooter(now),
                                      today: agenda.today,
                                      tomorrow: agenda.tomorrow)
        } else if let next {
            button.title = "下节 \(timeText(next.startsAt)) \(shortName(next.name))"
            button.toolTip = detail(next, now: now, ongoing: false)
            popoverController?.update(kicker: "下一节",
                                      headline: next.name,
                                      detail: detail(next, now: now, ongoing: false),
                                      footer: todayFooter(now),
                                      today: agenda.today,
                                      tomorrow: agenda.tomorrow)
        } else {
            button.title = "燕大"
            button.toolTip = "暂无课程安排"
            let nextText = agenda.tomorrow.first.map { "明天 \($0.time) \($0.title)" }
                ?? "未来 7 天没有更多课"
            popoverController?.update(kicker: "暂无课程",
                                      headline: agenda.today.isEmpty ? "今天没有课" : "今天课程已结束",
                                      detail: nextText,
                                      footer: "",
                                      today: agenda.today,
                                      tomorrow: agenda.tomorrow)
        }
    }

    private func agendaRows(now: Double, ongoing: ScheduledClass?, next: ScheduledClass?)
        -> (today: [StatusBarPopoverController.Row], tomorrow: [StatusBarPopoverController.Row]) {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date(timeIntervalSince1970: now / 1000))
        guard let end = calendar.date(byAdding: .day, value: 1, to: start),
              let tomorrowEnd = calendar.date(byAdding: .day, value: 2, to: start) else {
            return ([], [])
        }
        let endMs = end.timeIntervalSince1970 * 1000
        let tomorrowEndMs = tomorrowEnd.timeIntervalSince1970 * 1000
        let today = classes.filter { $0.endsAt > now && $0.startsAt < endMs }.prefix(3)
        let tomorrow = classes.filter { $0.startsAt >= endMs && $0.startsAt < tomorrowEndMs }.prefix(2)
        func row(_ item: ScheduledClass) -> StatusBarPopoverController.Row {
            StatusBarPopoverController.Row(
                time: timeText(item.startsAt),
                title: item.name,
                room: item.classroom,
                highlighted: item.startsAt == ongoing?.startsAt || item.startsAt == next?.startsAt
            )
        }
        return (today.map(row), tomorrow.map(row))
    }

    private func todayFooter(_ now: Double) -> String {
        let calendar = Calendar.current
        let date = Date(timeIntervalSince1970: now / 1000)
        guard let end = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: date)) else {
            return ""
        }
        let endMs = end.timeIntervalSince1970 * 1000
        let remaining = classes.filter { $0.startsAt > now && $0.startsAt < endMs }.count
        return remaining > 0 ? "今天还有 \(remaining) 节" : "今天没有更多课"
    }

    @objc private func statusItemClicked() {
        togglePopover()
    }

    private func installDismissMonitors() {
        removeDismissMonitors()
        guard let popover else { return }
        dismissMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        ) { [weak self] event in
            guard let self, let popover = self.popover, popover.isShown else { return event }
            if event.window === popover.contentViewController?.view.window { return event }
            if event.window === self.statusItem?.button?.window { return event }
            popover.performClose(nil)
            return event
        }
        resignObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.popover?.performClose(nil)
        }
        closeObserver = NotificationCenter.default.addObserver(
            forName: NSPopover.didCloseNotification,
            object: popover,
            queue: .main
        ) { [weak self] _ in
            DispatchQueue.main.async { self?.removeDismissMonitors() }
        }
    }

    private func removeDismissMonitors() {
        if let dismissMonitor {
            NSEvent.removeMonitor(dismissMonitor)
            self.dismissMonitor = nil
        }
        if let resignObserver {
            NotificationCenter.default.removeObserver(resignObserver)
            self.resignObserver = nil
        }
        if let closeObserver {
            NotificationCenter.default.removeObserver(closeObserver)
            self.closeObserver = nil
        }
    }

    @objc private func togglePopover() {
        guard let popover else { return }
        if popover.isShown {
            popover.performClose(nil)
            return
        }
        let show = { [weak self] in
            guard let self, let popover = self.popover, let button = self.statusItem?.button else { return }
            NSApplication.shared.activate(ignoringOtherApps: true)
            self.refresh()
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            self.installDismissMonitors()
        }
        guard let appearanceProvider else {
            show()
            return
        }
        appearanceProvider { [weak self] dark in
            let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            self?.popoverController?.applyAppearance(dark: dark)
            self?.popover?.appearance = appearance
            self?.popover?.contentViewController?.view.appearance = appearance
            show()
            DispatchQueue.main.async {
                self?.popover?.appearance = appearance
                self?.popover?.contentViewController?.view.window?.appearance = appearance
            }
        }
    }

    // MARK: - Formatting

    private func shortName(_ name: String) -> String {
        name.count > 8 ? String(name.prefix(8)) + "…" : name
    }

    private func timeText(_ milliseconds: Double) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1000))
    }

    private func detail(_ item: ScheduledClass, now: Double, ongoing: Bool) -> String {
        let start = Date(timeIntervalSince1970: item.startsAt / 1000)
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date(timeIntervalSince1970: now / 1000))
        let days = calendar.dateComponents([.day], from: today,
                                           to: calendar.startOfDay(for: start)).day ?? 0
        let prefix: String
        switch days {
        case 0: prefix = ""
        case 1: prefix = "明天 "
        default:
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "zh_CN")
            formatter.dateFormat = "EEE"
            prefix = formatter.string(from: start) + " "
        }
        var parts: [String] = ["\(prefix)\(timeText(item.startsAt))–\(timeText(item.endsAt))"]
        if !item.classroom.isEmpty { parts.append(item.classroom) }
        let minutes = max(1, Int((((ongoing ? item.endsAt : item.startsAt) - now) / 60_000).rounded(.up)))
        if ongoing {
            parts.append("剩余 \(minutes) 分钟")
        } else if minutes <= 120 {
            parts.append("\(minutes) 分钟后")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: - Persistence

    private func persist() {
        guard let data = try? JSONEncoder().encode(classes) else { return }
        UserDefaults.standard.set(data, forKey: defaultsKey)
    }

    private func loadClasses() -> [ScheduledClass] {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey),
              let decoded = try? JSONDecoder().decode([ScheduledClass].self, from: data) else {
            return []
        }
        return decoded
    }
}
