import Foundation
import Capacitor
import StoreKit

/**
 * Reports the App Store storefront's country (ISO 3166-1 alpha-3, e.g. "CHN")
 * so JS can turn the assistant off where it is not allowed (refs #587).
 * Resolves null when the device has no App Store account.
 */
@objc(StorefrontPlugin)
public class StorefrontPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StorefrontPlugin"
    public let jsName = "Storefront"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCountryCode", returnType: CAPPluginReturnPromise),
    ]

    @objc func getCountryCode(_ call: CAPPluginCall) {
        Task {
            let code = await Storefront.current?.countryCode
            call.resolve(["countryCode": code ?? NSNull()])
        }
    }
}
