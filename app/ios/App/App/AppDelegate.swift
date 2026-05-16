import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable : Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(name: Notification.Name("didReceiveRemoteNotification"), object: completionHandler, userInfo: userInfo)
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Badge count is managed by the JS notification store.
        // Do NOT clear here — it is decremented as the user views notifications.

        // Re-emit safe-area insets in case the device was rotated while the app
        // was backgrounded — viewWillTransition does not fire in that case, so
        // without this the CSS variables stay at the pre-background orientation.
        SafeAreaPlugin.shared?.emitInsetsChanged()
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

class ViewController: CAPBridgeViewController {
    private var safeAreaSettleWorkItem: DispatchWorkItem?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SSLTrustPlugin())
        bridge?.registerPluginInstance(SafeAreaPlugin())
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        // Primary emit path: after the rotation animation finishes, UIWindow.safeAreaInsets
        // holds the final stable values. viewSafeAreaInsetsDidChange fires multiple times
        // during the transition with stale intermediate values, so we deliberately do not
        // use that as the primary signal. See SafeAreaPlugin.swift.
        coordinator.animate(alongsideTransition: nil) { _ in
            SafeAreaPlugin.shared?.emitInsetsChanged()
        }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        // Fallback path: coordinator.animate's completion can be missed for interrupted
        // rotations, split-view resizes, or status-bar visibility toggles. Debounce so we
        // only emit once the insets have stopped changing (the last fire during a rotation
        // holds the final value). The primary path above usually wins; this is a safety net
        // for cases it doesn't cover.
        safeAreaSettleWorkItem?.cancel()
        let work = DispatchWorkItem {
            SafeAreaPlugin.shared?.emitInsetsChanged()
        }
        safeAreaSettleWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: work)
    }
}
