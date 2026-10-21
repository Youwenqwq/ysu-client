import AppKit

MainActor.assumeIsolated {
    let application = NSApplication.shared
    let appDelegate = AppDelegate()
    application.delegate = appDelegate
    application.run()
    withExtendedLifetime(appDelegate) {}
}
