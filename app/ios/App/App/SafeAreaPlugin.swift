import Foundation
import Capacitor
import UIKit

/**
 * Reads UIWindow.safeAreaInsets natively and pushes them to JS as
 * CSS variables (--sai-top/right/bottom/left).
 *
 * Workaround for iOS WKWebView + Capacitor 7 reporting stale or wrong
 * env(safe-area-inset-*) values across orientation changes with
 * contentInset='never' + viewport-fit=cover. Diagnosed under #147.
 *
 * Timing: emits once at plugin load() and once after each rotation
 * completes (driven from ViewController.viewWillTransition's animation
 * completion block). Reads from the window's safeAreaInsets rather than
 * the view controller's view, because the window value is UIKit's
 * source of truth and reliably reflects the final orientation.
 *
 * Earlier revision hooked viewSafeAreaInsetsDidChange instead. That fires
 * multiple times during a rotation transition, including with stale
 * intermediate values, and the last fire sometimes won — leading to JS
 * applying landscape insets while the device was in portrait. The
 * transition-completion approach fires once with the final stable value.
 *
 * The view controller now ALSO subscribes to viewSafeAreaInsetsDidChange as
 * a debounced (250 ms) fallback so interrupted rotations, split-view resizes,
 * and status-bar visibility toggles are not missed. The transition-completion
 * path remains primary; the debounced fallback only matters when it does not
 * fire.
 */
@objc(SafeAreaPlugin)
public class SafeAreaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SafeAreaPlugin"
    public let jsName = "SafeArea"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getInsets", returnType: CAPPluginReturnPromise),
    ]

    /// Weak shared reference so the host ViewController can poke us from
    /// viewWillTransition without coupling to Capacitor's plugin registry.
    public static weak var shared: SafeAreaPlugin?

    public override func load() {
        SafeAreaPlugin.shared = self
        // Emit once the view hierarchy has had a chance to lay out.
        DispatchQueue.main.async { [weak self] in
            self?.emitInsetsChanged()
        }
    }

    @objc func getInsets(_ call: CAPPluginCall) {
        let insets = currentInsets()
        call.resolve([
            "top": insets.top,
            "right": insets.right,
            "bottom": insets.bottom,
            "left": insets.left,
        ])
    }

    /// Called by the host ViewController after viewWillTransition completes.
    @objc public func emitInsetsChanged() {
        let insets = currentInsets()
        notifyListeners("safeAreaInsetsChanged", data: [
            "top": insets.top,
            "right": insets.right,
            "bottom": insets.bottom,
            "left": insets.left,
        ])
    }

    private func currentInsets() -> UIEdgeInsets {
        // UIWindow.safeAreaInsets is UIKit's source of truth for the device's
        // current safe area. Prefer it over viewController.view.safeAreaInsets,
        // which can lag during rotation.
        if let window = activeWindow() {
            return window.safeAreaInsets
        }
        return self.bridge?.viewController?.view.safeAreaInsets ?? .zero
    }

    private func activeWindow() -> UIWindow? {
        if #available(iOS 15.0, *) {
            return UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first { $0.isKeyWindow }
                ?? UIApplication.shared.connectedScenes
                    .compactMap { $0 as? UIWindowScene }
                    .flatMap { $0.windows }
                    .first
        } else {
            return UIApplication.shared.windows.first { $0.isKeyWindow }
                ?? UIApplication.shared.windows.first
        }
    }
}
