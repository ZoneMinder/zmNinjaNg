import Foundation
import Capacitor
import UIKit

/**
 * Reads UIView.safeAreaInsets natively and pushes them to JS as
 * CSS variables (--sai-top/right/bottom/left).
 *
 * Workaround for iOS WKWebView + Capacitor 7 reporting stale or
 * wrong env(safe-area-inset-*) values across orientation changes
 * with contentInset='never' + viewport-fit=cover. Diagnosed under
 * #147: env() reports landscape insets in portrait, top is always 0
 * on Dynamic Island devices.
 *
 * The plugin is fired from ViewController.viewSafeAreaInsetsDidChange()
 * — that's the native lifecycle hook UIKit calls whenever the safe area
 * actually changes, so JS sees insets that match what UIKit knows is
 * correct, not what env() guessed.
 */
@objc(SafeAreaPlugin)
public class SafeAreaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SafeAreaPlugin"
    public let jsName = "SafeArea"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getInsets", returnType: CAPPluginReturnPromise),
    ]

    /// Weak shared reference so the host ViewController can poke us from
    /// viewSafeAreaInsetsDidChange without coupling to Capacitor's plugin
    /// registry lookup APIs.
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

    /// Called by the host ViewController on viewSafeAreaInsetsDidChange.
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
        guard let view = self.bridge?.viewController?.view else {
            return .zero
        }
        return view.safeAreaInsets
    }
}
