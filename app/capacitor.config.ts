import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zoneminder.zmNinjaNG',
  appName: 'zmNinjaNg',
  webDir: 'dist',
  server: {
    // Cleartext and the http scheme are required because ZoneMinder servers are
    // user-configured at runtime and many run plain HTTP on a LAN. The host set
    // is not known at build time, so this cannot be scoped to specific domains
    // via static config (Android per-domain config / iOS NSExceptionDomains).
    // Accepted risk for a self-hosted-NVR client. ZM resources load via
    // img/fetch/websocket, not top-level navigation.
    //
    // No iosScheme: WKWebView reserves http, and Capacitor's
    // CAPInstanceDescriptor.normalize() drops any scheme
    // WKWebView.handlesURLScheme() claims and falls back to its default, so
    // the iOS origin is always capacitor://localhost whatever is set here.
    // Cleartext on iOS comes from NSAllowsArbitraryLoads in Info.plist.
    cleartext: true,
    androidScheme: 'http',
    // No allowNavigation wildcard: the app is a client-side-routed SPA and never
    // needs the webview to navigate to an external host. External links open in
    // the system browser (Browser plugin / setWindowOpenHandler). Omitting this
    // keeps the webview pinned to the app origin so a crafted link cannot
    // navigate it to an attacker page.
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#020817',
    allowsInlineMediaPlayback: true,
  },
  // Capacitor 8 removed `android.adjustMarginsForEdgeToEdge`; edge-to-edge is
  // now always on and insets are handled via CSS env(safe-area-inset-*) plus the
  // custom SafeArea plugin. Verify Android montage/montage-bar layout on device.
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: false,
      backgroundColor: '#000000',
      showSpinner: false,
      fadeOutDuration: 200,
    },
    FirebaseMessaging: {
      presentationOptions: ['alert', 'badge', 'sound'],
    },
  }
};

export default config;
