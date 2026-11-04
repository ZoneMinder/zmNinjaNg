package com.zoneminder.zmNinjaNG;

import android.app.UiModeManager;
import android.content.Context;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.zoneminder.zmNinjaNG.stream.ZmFrameWebViewClient;
import com.zoneminder.zmNinjaNG.stream.ZmStreamPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SSLTrustPlugin.class);
        registerPlugin(PipPlugin.class);
        registerPlugin(TvDetectorPlugin.class);
        registerPlugin(WindowThemePlugin.class);
        registerPlugin(GeminiNanoPlugin.class);
        registerPlugin(ZmStreamPlugin.class);
        super.onCreate(savedInstanceState);

        // Every webview client the app installs is a ZmFrameWebViewClient, so the
        // zmframe:// interception survives SSLTrustPlugin swapping the client when
        // self-signed trust is toggled. Without the interception, native MJPEG
        // frames never reach a tile.
        getBridge().setWebViewClient(new ZmFrameWebViewClient(getBridge(), false));

        if (isTVDevice()) {
            // Inject JS global before web content loads so the web layer
            // knows it's TV from the very first render
            getBridge().getWebView().evaluateJavascript(
                "window.__ZMNINJA_IS_TV__ = true;", null
            );
            wrapWebViewWithCursor();
        }

        // Post rather than call directly: Capacitor 8's core SystemBars plugin
        // queues setHidden(config.hidden=false) -> controller.show(bars) to the
        // main looper during plugin load (inside super.onCreate above). A direct
        // hide() here runs BEFORE that queued show() and is overridden, leaving
        // the status bar visible over the app's top chrome on a cold start in
        // landscape. Posting queues our visibility call after SystemBars' one.
        getWindow().getDecorView().post(() ->
            applyStatusBarVisibility(getResources().getConfiguration().orientation)
        );
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyStatusBarVisibility(newConfig.orientation);
        // Posted so it lands after SystemBars' own configuration-change
        // handler, which re-applies its tracked style and repaints the decor
        // view with the Android theme's windowBackground. Without this the
        // window flashes the OS night mode's colour - white behind a dark app
        // under a light system theme - while the WebView resizes (refs #356).
        getWindow().getDecorView().post(() -> WindowThemePlugin.reapply(getWindow()));
    }

    private void applyStatusBarVisibility(int orientation) {
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        int bars = WindowInsetsCompat.Type.systemBars();
        if (orientation == Configuration.ORIENTATION_LANDSCAPE) {
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            controller.hide(bars);
        } else {
            controller.show(bars);
        }
    }

    private boolean isTVDevice() {
        UiModeManager uiModeManager = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        return uiModeManager != null
            && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    private void wrapWebViewWithCursor() {
        // Post to ensure the WebView is fully initialized
        getBridge().getWebView().post(() -> {
            WebView webView = getBridge().getWebView();
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent == null) return;

            int index = parent.indexOfChild(webView);
            ViewGroup.LayoutParams params = webView.getLayoutParams();

            // Remove WebView from its parent
            parent.removeView(webView);

            // Create the cursor layout and add WebView as its child
            TvCursorLayout cursorLayout = new TvCursorLayout(this);
            cursorLayout.setLayoutParams(params);
            cursorLayout.addView(webView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ));

            // Put the cursor layout where the WebView was
            parent.addView(cursorLayout, index);

            // Request focus so D-pad events are received
            cursorLayout.setFocusable(true);
            cursorLayout.setFocusableInTouchMode(true);
            cursorLayout.requestFocus();
        });
    }
}
