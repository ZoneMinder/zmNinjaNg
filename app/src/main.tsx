import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { Platform } from './lib/platform'
import { installSafeAreaBootstrap } from './lib/safe-area-bootstrap'
import { installGlobalErrorHandlers } from './lib/global-error-handlers'
import { installTapJitterGuard } from './lib/tap-jitter-guard'

// Route unhandled promise rejections and uncaught window errors into the
// in-app log system before anything else runs. refs #182.
installGlobalErrorHandlers();

// Tag the root on native so CSS can disable long-press text selection
// and touch callouts app-wide. Inputs and contenteditable fields opt
// back in. See index.css.
if (Platform.isNative) {
  document.documentElement.classList.add('is-native');
}

// Mirror native iOS UIView.safeAreaInsets into --sai-* CSS variables on every
// orientation change. Workaround for env(safe-area-inset-*) being stale in iOS
// WKWebView with contentInset='never'. refs #147.
void installSafeAreaBootstrap();

// iPhone in landscape sends a small touchmove with most taps; Radix modals'
// scroll lock cancels it and WebKit then drops the click. refs #534.
if (Platform.isIOS) {
  installTapJitterGuard();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
