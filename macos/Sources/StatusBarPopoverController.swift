import AppKit

/// 菜单栏唯一面板：今明课程 + 常用菜单项，左键/右键/热键都走这里。
final class StatusBarPopoverController: NSViewController {
    struct Row {
        let time: String
        let title: String
        let room: String
        let highlighted: Bool
    }

    private let kicker = NSTextField(labelWithString: "")
    private let headline = NSTextField(labelWithString: "")
    private let detail = NSTextField(labelWithString: "")
    private let footer = NSTextField(labelWithString: "")
    private let todayLabel = NSTextField(labelWithString: "今天")
    private let tomorrowLabel = NSTextField(labelWithString: "明天")
    private let todayStack = NSStackView()
    private let tomorrowStack = NSStackView()
    private var isDark = false

    override func loadView() {
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 200))
        root.wantsLayer = true
        root.layer?.cornerRadius = 10
        root.layer?.masksToBounds = true

        kicker.font = .systemFont(ofSize: 11, weight: .medium)
        kicker.setContentCompressionResistancePriority(.required, for: .horizontal)

        headline.font = .systemFont(ofSize: 15, weight: .semibold)
        headline.lineBreakMode = .byWordWrapping
        headline.maximumNumberOfLines = 2
        headline.preferredMaxLayoutWidth = 272

        detail.font = .systemFont(ofSize: 12)
        detail.lineBreakMode = .byTruncatingTail
        detail.maximumNumberOfLines = 2

        footer.font = .systemFont(ofSize: 11)
        footer.alignment = .right

        for label in [todayLabel, tomorrowLabel] {
            label.font = .systemFont(ofSize: 10, weight: .medium)
        }
        for stack in [todayStack, tomorrowStack] {
            stack.orientation = .vertical
            stack.alignment = .leading
            stack.spacing = 4
        }

        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let header = NSStackView(views: [kicker, spacer, footer])
        header.orientation = .horizontal
        header.spacing = 8

        let separator = NSBox()
        separator.boxType = .separator

        let stack = NSStackView(views: [
            header, headline, detail, separator,
            todayLabel, todayStack, tomorrowLabel, tomorrowStack,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 6
        stack.detachesHiddenViews = true
        stack.setCustomSpacing(2, after: header)
        stack.setCustomSpacing(10, after: detail)
        stack.setCustomSpacing(3, after: todayLabel)
        stack.setCustomSpacing(3, after: tomorrowLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false

        let widthItems: [NSView] = [header, headline, detail, separator, todayLabel,
                                    todayStack, tomorrowLabel, tomorrowStack]
        for item in widthItems {
            item.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }

        root.addSubview(stack)
        NSLayoutConstraint.activate([
            root.widthAnchor.constraint(equalToConstant: 300),
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: root.bottomAnchor, constant: -14),
        ])
        view = root
    }

    func applyAppearance(dark: Bool) {
        _ = view
        isDark = dark
        let white = NSColor.white
        view.layer?.backgroundColor = (dark ? NSColor(calibratedWhite: 0.11, alpha: 1)
                                           : NSColor.windowBackgroundColor).cgColor
        kicker.textColor = dark ? white.withAlphaComponent(0.60) : .secondaryLabelColor
        headline.textColor = dark ? white : .labelColor
        detail.textColor = dark ? white.withAlphaComponent(0.66) : .secondaryLabelColor
        footer.textColor = dark ? white.withAlphaComponent(0.42) : .tertiaryLabelColor
        todayLabel.textColor = dark ? white.withAlphaComponent(0.45) : .tertiaryLabelColor
        tomorrowLabel.textColor = todayLabel.textColor
    }

    func update(kicker: String, headline: String, detail: String, footer: String,
                today: [Row], tomorrow: [Row]) {
        _ = view
        self.kicker.stringValue = kicker
        self.headline.stringValue = headline
        self.detail.stringValue = detail
        self.footer.stringValue = footer
        rebuild(todayStack, rows: today)
        rebuild(tomorrowStack, rows: tomorrow)
        todayLabel.isHidden = today.isEmpty
        todayStack.isHidden = today.isEmpty
        tomorrowLabel.isHidden = tomorrow.isEmpty
        tomorrowStack.isHidden = tomorrow.isEmpty
        view.layoutSubtreeIfNeeded()
        preferredContentSize = NSSize(width: 300, height: max(190, view.fittingSize.height))
    }

    private func rebuild(_ stack: NSStackView, rows: [Row]) {
        for view in stack.arrangedSubviews {
            stack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        for row in rows {
            stack.addArrangedSubview(makeRow(row))
        }
    }

    private func makeRow(_ row: Row) -> NSView {
        let white = NSColor.white
        let time = NSTextField(labelWithString: row.time)
        time.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
        time.textColor = row.highlighted
            ? (isDark ? .white : .controlAccentColor)
            : (isDark ? white.withAlphaComponent(0.55) : .secondaryLabelColor)
        time.widthAnchor.constraint(equalToConstant: 36).isActive = true

        let title = NSTextField(labelWithString: row.title)
        title.font = .systemFont(ofSize: 12)
        title.textColor = isDark ? white : .labelColor
        title.lineBreakMode = .byTruncatingTail
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let room = NSTextField(labelWithString: row.room)
        room.font = .systemFont(ofSize: 11)
        room.textColor = isDark ? white.withAlphaComponent(0.5) : .tertiaryLabelColor
        room.setContentHuggingPriority(.required, for: .horizontal)

        let stack = NSStackView(views: [time, title, room])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 8
        return stack
    }
}
