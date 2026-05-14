import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { Platform } from './lib/platform'
import { installRotationDiagnostic } from './lib/rotation-diagnostic'

// Tag the root on native so CSS can disable long-press text selection
// and touch callouts app-wide. Inputs and contenteditable fields opt
// back in — see index.css.
if (Platform.isNative) {
  document.documentElement.classList.add('is-native');
}

// Temporary iOS rotation diagnostic — refs #147. Logs viewport / env() / WKWebView
// frame on every rotation. Remove this once the rotation gap is diagnosed.
installRotationDiagnostic();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
