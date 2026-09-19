/**
 * useCapacitorListener Hook
 *
 * Registers an event listener on an async-loaded Capacitor plugin and tears
 * it down on unmount. Centralizes the pattern previously duplicated across
 * components: dynamic plugin import, `await addListener`, a cancelled flag
 * checked after each await so a handle that resolves post-unmount is removed
 * immediately, and a teardown that sets the flag before removing the handle.
 *
 * The getter resolves with a `{ plugin }` wrapper rather than the plugin
 * itself, because a `registerPlugin` proxy answers every property access with
 * a native method call: a promise resolved with one probes `.then` as a plugin
 * method, iOS rejects it ("App.then() is not implemented on ios"), and the
 * promise never settles, so the await below hangs and the listener is never
 * registered (refs #507). Pass
 * `() => import('@capacitor/app').then((m) => ({ plugin: m.App }))`. The
 * specifier must be a static string so Vite can analyze and code-split it,
 * never a template literal.
 *
 * The handler is kept in a ref, so callers do not need stable callback
 * identities and the listener never re-registers on handler changes. Plugin
 * load failures are swallowed (matching the previous per-site behavior);
 * pass `onError` to log them instead.
 */

import { useEffect, useRef } from 'react';
import { Platform } from '../lib/platform';

/** Subset of Capacitor's PluginListenerHandle the hook needs. */
export interface CapacitorListenerHandle {
  remove(): void | Promise<void>;
}

/**
 * Structural type for any Capacitor plugin exposing addListener.
 * Concrete plugins declare addListener as per-event-name overloads
 * (AppPlugin, NetworkPlugin, ...); `any` parameters are the only signature
 * every overload set is assignable to. Type safety for the event payload
 * comes from the handler parameter at the call site.
 */
export interface CapacitorListenerSource {
  addListener(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventName: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (data: any) => void,
  ): Promise<CapacitorListenerHandle>;
}

/** What the getter resolves with: the plugin, wrapped so it is not a thenable. */
export interface CapacitorPluginRef {
  plugin: CapacitorListenerSource;
}

export interface UseCapacitorListenerOptions {
  /**
   * Register the listener only while true.
   * Defaults to `Platform.isNative`.
   */
  enabled?: boolean;
  /** Called when loading the plugin or registering the listener fails. */
  onError?: (error: unknown) => void;
}

export function useCapacitorListener<TData = void>(
  getPlugin: () => Promise<CapacitorPluginRef>,
  eventName: string,
  handler: (data: TData) => void,
  opts: UseCapacitorListenerOptions = {},
): void {
  const enabled = opts.enabled ?? Platform.isNative;

  // Refs keep the latest callbacks visible to the registration effect
  // without making them effect dependencies.
  const getPluginRef = useRef(getPlugin);
  const handlerRef = useRef(handler);
  const onErrorRef = useRef(opts.onError);
  useEffect(() => {
    getPluginRef.current = getPlugin;
    handlerRef.current = handler;
    onErrorRef.current = opts.onError;
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let handle: CapacitorListenerHandle | undefined;

    (async () => {
      try {
        const { plugin } = await getPluginRef.current();
        const resolved = await plugin.addListener(eventName, (data: TData) => {
          handlerRef.current(data);
        });
        if (cancelled) {
          // Teardown already ran; remove the late-resolving handle.
          void resolved.remove();
        } else {
          handle = resolved;
        }
      } catch (error) {
        onErrorRef.current?.(error);
      }
    })();

    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [enabled, eventName]);
}
