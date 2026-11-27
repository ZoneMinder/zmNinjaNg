import Foundation
import Capacitor
import UserNotifications

/**
 * Lists the app's notifications in Notification Center with the time iOS
 * delivered each one. @capacitor-firebase/messaging's
 * getDeliveredNotifications drops UNNotification.date, so notifications read
 * from the tray were timed by when the app read them (issue #615).
 */
@objc(DeliveredNotificationsPlugin)
public class DeliveredNotificationsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeliveredNotificationsPlugin"
    public let jsName = "DeliveredNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getDelivered", returnType: CAPPluginReturnPromise),
    ]

    @objc func getDelivered(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getDeliveredNotifications { delivered in
            let notifications: [JSObject] = delivered.map { notification in
                let content = notification.request.content
                var result = JSObject()
                result["id"] = notification.request.identifier
                result["title"] = content.title
                result["body"] = content.body
                result["data"] = JSTypes.coerceDictionaryToJSObject(content.userInfo) ?? [:]
                result["time"] = notification.date.timeIntervalSince1970 * 1000
                return result
            }
            call.resolve(["notifications": notifications])
        }
    }
}
