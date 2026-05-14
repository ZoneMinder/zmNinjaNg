import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import './i18n'
import App from './App.tsx'
import { Platform } from './lib/platform'

// Tag the root on native so CSS can disable long-press text selection
// and touch callouts app-wide. Inputs and contenteditable fields opt
// back in — see index.css.
if (Platform.isNative) {
  document.documentElement.classList.add('is-native');
}

// iOS WKWebView can fail to recompute env(safe-area-inset-*) after
// orientation changes, leaving page content overlapping the status bar
// when rotating back to portrait. Re-set the viewport meta content on
// orientationchange to force WebKit to re-parse and re-evaluate the
// safe-area insets. refs #147.
if (Capacitor.getPlatform() === 'ios') {
  const forceViewportRecompute = () => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute('content') ?? '';
    // Trailing whitespace is enough to make WebKit re-parse the meta.
    meta.setAttribute('content', `${original} `);
    requestAnimationFrame(() => {
      meta.setAttribute('content', original);
    });
  };
  window.addEventListener('orientationchange', () => {
    // Wait for the orientation animation to settle, then again after a
    // longer delay so it survives any late WebKit layout passes.
    setTimeout(forceViewportRecompute, 350);
    setTimeout(forceViewportRecompute, 800);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
