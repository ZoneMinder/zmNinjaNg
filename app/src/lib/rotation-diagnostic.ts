/**
 * iOS rotation diagnostic — temporary, refs #147.
 *
 * Captures viewport, env(safe-area-inset-*), WKWebView frame, and mobile-header
 * bounding rect on every orientation change and visualViewport resize. Output
 * goes through log.app so it lands in the Xcode console and Safari Web Inspector
 * with the "Diagnostic" prefix for easy grep.
 *
 * Also exposes window.__rotDiag() for on-demand capture from Safari Web Inspector
 * when the gap is visible on-screen.
 */

import { Capacitor } from '@capacitor/core';
import { log, LogLevel } from './logger';

let probe: HTMLDivElement | null = null;

function getProbe(): HTMLDivElement {
  if (probe && document.body.contains(probe)) return probe;
  probe = document.createElement('div');
  probe.id = '__rotation_diag_probe__';
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);' +
    'padding-right:env(safe-area-inset-right);' +
    'padding-bottom:env(safe-area-inset-bottom);' +
    'padding-left:env(safe-area-inset-left);';
  document.body.appendChild(probe);
  return probe;
}

function pxToNumber(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function readEnvInsets() {
  const cs = getComputedStyle(getProbe());
  return {
    top: pxToNumber(cs.paddingTop),
    right: pxToNumber(cs.paddingRight),
    bottom: pxToNumber(cs.paddingBottom),
    left: pxToNumber(cs.paddingLeft),
  };
}

function snapshot(reason: string) {
  const vv = window.visualViewport;
  const html = document.documentElement;
  const body = document.body;
  const root = document.getElementById('root');
  const header = document.querySelector<HTMLElement>(
    '.md\\:hidden.fixed.top-0',
  );
  const headerRect = header?.getBoundingClientRect();

  // computedHtmlHeight is what 100% on body resolves against — useful to see
  // whether the percentage chain would have given the right value.
  const htmlComputed = getComputedStyle(html);
  const bodyComputed = getComputedStyle(body);
  const rootComputed = root ? getComputedStyle(root) : null;

  const insets = readEnvInsets();

  log.app(`[Diagnostic] ${reason}`, LogLevel.INFO, {
    reason,
    orientation: {
      angle: window.screen.orientation?.angle ?? null,
      type: window.screen.orientation?.type ?? null,
      legacyOrientation: 'orientation' in window ? (window as Window & { orientation?: number }).orientation : null,
    },
    window: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    visualViewport: vv
      ? {
          width: vv.width,
          height: vv.height,
          scale: vv.scale,
          offsetTop: vv.offsetTop,
          offsetLeft: vv.offsetLeft,
          pageTop: vv.pageTop,
          pageLeft: vv.pageLeft,
        }
      : null,
    envInsets: insets,
    html: {
      clientWidth: html.clientWidth,
      clientHeight: html.clientHeight,
      offsetHeight: html.offsetHeight,
      scrollHeight: html.scrollHeight,
      computedHeight: htmlComputed.height,
    },
    body: {
      clientWidth: body.clientWidth,
      clientHeight: body.clientHeight,
      offsetHeight: body.offsetHeight,
      scrollHeight: body.scrollHeight,
      computedHeight: bodyComputed.height,
    },
    root: root
      ? {
          clientWidth: root.clientWidth,
          clientHeight: root.clientHeight,
          offsetHeight: root.offsetHeight,
          scrollHeight: root.scrollHeight,
          computedHeight: rootComputed?.height ?? null,
        }
      : null,
    mobileHeader: header
      ? {
          rect: headerRect
            ? {
                top: headerRect.top,
                left: headerRect.left,
                width: headerRect.width,
                height: headerRect.height,
                bottom: headerRect.bottom,
              }
            : null,
          computedHeight: getComputedStyle(header).height,
          computedPaddingTop: getComputedStyle(header).paddingTop,
        }
      : null,
  });
}

export function installRotationDiagnostic(): void {
  if (Capacitor.getPlatform() !== 'ios') return;

  // Expose a manual trigger for Safari Web Inspector use.
  (window as unknown as { __rotDiag?: (label?: string) => void }).__rotDiag = (
    label = 'manual',
  ) => snapshot(label);

  // Initial snapshot once the DOM has had a chance to lay out.
  setTimeout(() => snapshot('initial'), 500);

  window.addEventListener('orientationchange', () => {
    snapshot('orientationchange:immediate');
    setTimeout(() => snapshot('orientationchange:+100ms'), 100);
    setTimeout(() => snapshot('orientationchange:+500ms'), 500);
    setTimeout(() => snapshot('orientationchange:+1000ms'), 1000);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      snapshot('visualViewport:resize');
    });
  }
}
