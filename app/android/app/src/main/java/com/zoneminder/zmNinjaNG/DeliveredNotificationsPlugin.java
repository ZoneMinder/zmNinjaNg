package com.zoneminder.zmNinjaNG;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.service.notification.StatusBarNotification;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lists the app's notifications in the tray with the time Android posted each
 * one. @capacitor-firebase/messaging's getDeliveredNotifications drops
 * getPostTime(), so notifications read from the tray were timed by when the
 * app read them (issue #615). The other fields match that plugin's.
 */
@CapacitorPlugin(name = "DeliveredNotifications")
public class DeliveredNotificationsPlugin extends Plugin {

    @PluginMethod()
    public void getDelivered(PluginCall call) {
        try {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            JSArray notifications = new JSArray();
            for (StatusBarNotification sbn : manager.getActiveNotifications()) {
                JSObject result = new JSObject();
                result.put("id", "" + sbn.getId());
                result.put("tag", sbn.getTag());
                result.put("time", sbn.getPostTime());
                Notification notification = sbn.getNotification();
                if (notification != null) {
                    result.put("title", notification.extras.getCharSequence(Notification.EXTRA_TITLE));
                    result.put("body", notification.extras.getCharSequence(Notification.EXTRA_TEXT));
                    JSObject extras = new JSObject();
                    for (String key : notification.extras.keySet()) {
                        extras.put(key, notification.extras.get(key));
                    }
                    result.put("data", extras);
                }
                notifications.put(result);
            }
            JSObject ret = new JSObject();
            ret.put("notifications", notifications);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read delivered notifications", e);
        }
    }
}
