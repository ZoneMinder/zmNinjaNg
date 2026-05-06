package com.zoneminder.zmNinjaNG;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WindowTheme")
public class WindowThemePlugin extends Plugin {

    @PluginMethod
    public void setBackgroundColor(PluginCall call) {
        String hex = call.getString("color");
        if (hex == null || hex.isEmpty()) {
            call.reject("color required");
            return;
        }
        try {
            int color = Color.parseColor(hex);
            // Use luminance to decide whether system bar icons should be dark (light bg) or light (dark bg).
            double luminance = (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255.0;
            boolean useDarkIcons = luminance > 0.5;
            getActivity().runOnUiThread(() -> {
                Window window = getActivity().getWindow();
                window.setBackgroundDrawable(new ColorDrawable(color));
                WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(window, window.getDecorView());
                controller.setAppearanceLightStatusBars(useDarkIcons);
                controller.setAppearanceLightNavigationBars(useDarkIcons);
            });
            call.resolve();
        } catch (IllegalArgumentException e) {
            call.reject("Invalid color: " + hex, e);
        }
    }
}
