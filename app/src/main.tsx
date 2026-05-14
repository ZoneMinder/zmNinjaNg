import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { Platform } from './lib/platform'
import { installSafeAreaBootstrap } from './lib/safe-area-bootstrap'

// Tag the root on native so CSS can disable long-press text selection
// and touch callouts app-wide. Inputs and contenteditable fields opt
// back in — see index.css.
if (Platform.isNative) {
  document.documentElement.classList.add('is-native');
}

// Mirror native iOS UIView.safeAreaInsets into --sai-* CSS variables on every
// orientation change. Workaround for env(safe-area-inset-*) being stale in iOS
// WKWebView with contentInset='never'. refs #147.
void installSafeAreaBootstrap();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
