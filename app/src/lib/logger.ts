/**
 * Centralized Logging Utility
 *
 * Provides a structured logging system with support for log levels, context, and sanitization.
 * Each accepted entry is sent to the console, the in-memory `useLogStore` (for the
 * Logs view), and a platform-specific `LogFileStore` (Capacitor on mobile, Tauri on
 * desktop, no-op on web) for persistent disk logging.
 *
 * Features:
 * - Log levels (DEBUG, INFO, WARN, ERROR)
 * - Automatic sanitization of sensitive data (passwords, tokens)
 * - Context-aware logging (component, action)
 * - Specialized helpers for common domains (API, Auth, Profile, Monitor)
 * - Supports log level preferences managed by profile settings
 */

import { useLogStore, type LogEntry } from '../stores/logs';
import { sanitizeLogMessage, sanitizeObject, sanitizeLogArgs } from './log-sanitizer';
import { LogLevel } from './log-level';
import { getLogFile } from './log-file';

interface LogContext {
  component?: string;
  action?: string;
  [key: string]: unknown;
}

interface DedupeState {
  lastEmit: number;
  suppressed: number;
}

class Logger {
  private level: LogLevel;
  private isDev: boolean;
  private componentLevels: Record<string, LogLevel> = {};
  private dedupeState = new Map<string, DedupeState>();

  constructor() {
    this.isDev = this.resolveIsDev();
    // Default to INFO in production to ensure logs are visible in simulator/device
    this.level = this.isDev ? LogLevel.DEBUG : LogLevel.INFO;
  }

  private resolveIsDev(): boolean {
    if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env.DEV === 'boolean') {
      return import.meta.env.DEV;
    }
    if (typeof process !== 'undefined' && process.env && typeof process.env.NODE_ENV === 'string') {
      return process.env.NODE_ENV !== 'production';
    }
    return false;
  }

  /**
   * Set the current log level.
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get the current log level.
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Set the log level for a single component, overriding the global level.
   */
  setComponentLevel(component: string, level: LogLevel): void {
    this.componentLevels[component] = level;
  }

  /**
   * Replace all per-component log level overrides.
   * Accepts Record<string, number> for compatibility with persisted settings.
   */
  setComponentLevels(levels: Record<string, number>): void {
    this.componentLevels = { ...levels } as Record<string, LogLevel>;
  }

  /**
   * Get a copy of the current per-component log level overrides.
   */
  getComponentLevels(): Record<string, LogLevel> {
    return { ...this.componentLevels };
  }

  /**
   * Remove all per-component log level overrides.
   */
  clearComponentLevels(): void {
    this.componentLevels = {};
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  /**
   * Dedupe gate: returns the suppressed count to inline into the message
   * if the caller should emit now, otherwise null. First call always emits
   * with suppressed=0; subsequent calls within `windowMs` are counted and
   * suppressed; the next call after the window emits with the accumulated
   * suppressed count so the user sees a single "(+N suppressed)" footnote.
   */
  dedupeGate(key: string, windowMs: number): { suppressed: number } | null {
    const now = Date.now();
    const state = this.dedupeState.get(key) ?? { lastEmit: 0, suppressed: 0 };
    if (now - state.lastEmit >= windowMs) {
      const suppressed = state.suppressed;
      this.dedupeState.set(key, { lastEmit: now, suppressed: 0 });
      return { suppressed };
    }
    state.suppressed += 1;
    this.dedupeState.set(key, state);
    return null;
  }

  /**
   * Component-scoped collapsed group log: emits a single click-to-expand
   * row in the console and a single entry in the in-memory + file sinks.
   *
   * Use this for HTTP completions or any log where the headline is the
   * 99% view and the full payload is something you want available but
   * not pinned open. Falls back to a flat log if console.groupCollapsed
   * is unavailable.
   */
  groupCollapsed(
    componentName: string,
    message: string,
    level: LogLevel,
    body: unknown,
  ): void {
    if (level < LogLevel.DEBUG || level > LogLevel.ERROR) return;
    const effectiveLevel = this.componentLevels[componentName] ?? this.level;
    if (level < effectiveLevel) return;

    const timestamp = new Date().toLocaleString();
    const levelNames: Record<number, string> = { 0: 'DEBUG', 1: 'INFO', 2: 'WARN', 3: 'ERROR' };
    const levelName = levelNames[level] ?? 'DEBUG';
    const prefix = `${timestamp} ${levelName} [${componentName}]`;

    const sanitizedMessage = sanitizeLogMessage(message);
    const sanitizedBody = sanitizeObject(body);

    // Console: collapsed group with the full body inside. The user clicks
    // to expand. Falls back to a normal emit if the runtime doesn't
    // implement console groups (e.g. some test environments).
    const canGroup =
      typeof console.groupCollapsed === 'function' &&
      typeof console.groupEnd === 'function';
    const innerEmit =
      level === LogLevel.ERROR ? console.error :
      level === LogLevel.WARN ? console.warn :
      level === LogLevel.DEBUG ? console.debug :
      console.info;
    if (canGroup) {
      // Use the level-matched method for the group label too so DevTools
      // colors the headline (Safari respects this; Chrome only honors
      // groupCollapsed on console.log, which is fine).
      const groupFn = console.groupCollapsed.bind(console);
      groupFn(prefix, sanitizedMessage);
      innerEmit(sanitizedBody);
      console.groupEnd();
    } else {
      innerEmit(prefix, sanitizedMessage, sanitizedBody);
    }

    // Single entry to in-memory + file sinks. The Logs page renders args
    // as expandable JSON, mirroring the console's collapse/expand UX.
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp,
      rawTimestamp: Date.now(),
      level: levelName,
      message: sanitizedMessage,
      context: { component: componentName },
      args: sanitizedBody !== undefined ? [sanitizedBody] : undefined,
    };
    useLogStore.getState().addLog(entry);
    try {
      getLogFile().append(entry);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[logger] log-file append threw', err);
    }
  }

  private formatMessage(level: string, context: LogContext, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toLocaleString();
    const contextStr = context.component ? `[${context.component}]` : '';
    const actionStr = context.action ? `{${context.action}}` : '';

    const prefix = `${timestamp} ${level} ${contextStr}${actionStr}`;

    // Sanitize before logging to console and store
    const sanitizedMessage = sanitizeLogMessage(message);
    const sanitizedContext = sanitizeObject(context) as LogContext;
    const sanitizedArgs = args.length > 0 ? sanitizeLogArgs(args) : [];

    // Prepare context for console (exclude component/action as they are in prefix)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { component, action, ...consoleContext } = sanitizedContext;
    const hasContext = Object.keys(consoleContext).length > 0;

    // Log sanitized data to console
    const consoleArgs: unknown[] = [prefix, sanitizedMessage];
    if (hasContext) {
      consoleArgs.push(consoleContext);
    }
    if (sanitizedArgs.length > 0) {
      consoleArgs.push(...sanitizedArgs);
    }

    // Map our levels to the matching console method so DevTools
    // severity filters and color cues work natively.
    const emit =
      level === 'ERROR' ? console.error :
      level === 'WARN' ? console.warn :
      level === 'DEBUG' ? console.debug :
      console.info;
    emit(...consoleArgs);

    // formatMessage runs only after the global/per-component level filter has
    // passed (every public log helper gates on shouldLog/effectiveLevel before
    // calling here), so both sinks below are gated by the same filter.
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp,
      rawTimestamp: Date.now(),
      level,
      message: sanitizedMessage,
      context: sanitizedContext,
      args: sanitizedArgs.length > 0 ? sanitizedArgs : undefined,
    };
    useLogStore.getState().addLog(entry);
    try {
      getLogFile().append(entry);
    } catch (err) {
      // Fire-and-forget contract: a buggy impl must not break the caller.
      // eslint-disable-next-line no-console
      console.warn('[logger] log-file append threw', err);
    }
  }

  debug(message: string, context: LogContext = {}, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.formatMessage('DEBUG', context, message, ...args);
    }
  }

  info(message: string, context: LogContext = {}, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.formatMessage('INFO', context, message, ...args);
    }
  }

  warn(message: string, context: LogContext = {}, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.formatMessage('WARN', context, message, ...args);
    }
  }

  error(message: string, context: LogContext = {}, error?: Error | unknown, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.formatMessage('ERROR', context, message, error, ...args);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
  }

  // Helper to check if details has meaningful content
  private hasDetails(details: unknown): boolean {
    if (details === undefined || details === null) return false;
    if (typeof details === 'object' && Object.keys(details as object).length === 0) return false;
    return true;
  }

  // Helper method to create component loggers.
  // Uses per-component level override when set, falling back to the global level.
  // Calls formatMessage directly to bypass the global shouldLog check so that
  // a component override (e.g. DEBUG) works even when the global level is higher.
  private createComponentLogger(componentName: string, message: string, level: LogLevel, details?: unknown): void {
    if (level < LogLevel.DEBUG || level > LogLevel.ERROR) return;

    // Per-component level overrides global level
    const effectiveLevel = this.componentLevels[componentName] ?? this.level;
    if (level < effectiveLevel) return;

    const context = { component: componentName };
    const hasDetailsArg = this.hasDetails(details);
    const levelNames: Record<number, string> = { 0: 'DEBUG', 1: 'INFO', 2: 'WARN', 3: 'ERROR' };
    const levelName = levelNames[level] || 'DEBUG';

    if (level === LogLevel.ERROR && hasDetailsArg && typeof details === 'object') {
      this.formatMessage(levelName, context, message, JSON.stringify(details, null, 2));
    } else if (hasDetailsArg) {
      this.formatMessage(levelName, context, message, details);
    } else {
      this.formatMessage(levelName, context, message);
    }
  }

  // Component-specific loggers generated via factory pattern
  // Each method signature is explicitly defined for TypeScript autocomplete
  api = this.makeComponentLogger('API', LogLevel.DEBUG);
  app = this.makeComponentLogger('App');
  auth = this.makeComponentLogger('Auth', LogLevel.INFO);
  crypto = this.makeComponentLogger('Crypto');
  dashboard = this.makeComponentLogger('Dashboard');
  discovery = this.makeComponentLogger('Discovery');
  download = this.makeComponentLogger('Download');
  errorBoundary = this.makeComponentLogger('ErrorBoundary');
  eventCard = this.makeComponentLogger('EventCard');
  eventDetail = this.makeComponentLogger('EventDetail');
  eventMontage = this.makeComponentLogger('EventMontage');
  http = this.makeComponentLogger('HTTP');
  imageError = this.makeComponentLogger('ImageError');
  kiosk = this.makeComponentLogger('Kiosk');
  monitor = this.makeComponentLogger('Monitor', LogLevel.DEBUG);
  monitorCard = this.makeComponentLogger('MonitorCard');
  monitorDetail = this.makeComponentLogger('MonitorDetail');
  montageMonitor = this.makeComponentLogger('MontageMonitor');
  navigation = this.makeComponentLogger('Navigation');
  notificationHandler = this.makeComponentLogger('NotificationHandler');
  notifications = this.makeComponentLogger('Notifications');
  notificationSettings = this.makeComponentLogger('NotificationSettings');
  profile = this.makeComponentLogger('Profile', LogLevel.INFO);
  profileForm = this.makeComponentLogger('ProfileForm');
  profileService = this.makeComponentLogger('ProfileService');
  profileSwitcher = this.makeComponentLogger('ProfileSwitcher');
  push = this.makeComponentLogger('Push');
  queryCache = this.makeComponentLogger('QueryCache');
  secureImage = this.makeComponentLogger('SecureImage');
  secureStorage = this.makeComponentLogger('SecureStorage');
  server = this.makeComponentLogger('Server');
  time = this.makeComponentLogger('Time');
  timeline = this.makeComponentLogger('Timeline');
  videoMarkers = this.makeComponentLogger('VideoMarkers');
  videoPlayer = this.makeComponentLogger('VideoPlayer');
  sslTrust = this.makeComponentLogger('SSLTrust');
  zmsEventPlayer = this.makeComponentLogger('ZmsEventPlayer');

  // Factory method to create component loggers with optional default level
  private makeComponentLogger(componentName: string, defaultLevel?: LogLevel) {
    return (message: string, level?: LogLevel, details?: unknown): void => {
      const logLevel = level ?? defaultLevel;
      if (logLevel === undefined) {
        throw new Error(`Log level is required for ${componentName} logger`);
      }
      this.createComponentLogger(componentName, message, logLevel, details);
    };
  }
}

// Export singleton instance
export const logger = new Logger();

// Export convenience methods
export { LogLevel } from './log-level';

// Create component logger wrappers dynamically
const componentLoggers = [
  'api', 'app', 'auth', 'crypto', 'dashboard', 'discovery', 'download', 'errorBoundary',
  'eventCard', 'eventDetail', 'eventMontage', 'http', 'imageError', 'kiosk', 'monitor', 'monitorCard',
  'monitorDetail', 'montageMonitor', 'navigation', 'notificationHandler', 'notifications',
  'notificationSettings', 'profile', 'profileForm', 'profileService', 'profileSwitcher',
  'push', 'queryCache', 'secureImage', 'secureStorage', 'server', 'sslTrust', 'time', 'timeline',
  'videoMarkers', 'videoPlayer', 'zmsEventPlayer'
] as const;

type ComponentLoggerKey = typeof componentLoggers[number];
type ComponentLoggers = Record<ComponentLoggerKey, (message: string, level?: LogLevel, details?: unknown) => void>;

// Generate component logger methods dynamically
const generatedComponentLoggers = componentLoggers.reduce((acc, key) => {
  acc[key] = (message: string, level?: LogLevel, details?: unknown) =>
    (logger as unknown as Record<string, (message: string, level?: LogLevel, details?: unknown) => void>)[key](message, level, details);
  return acc;
}, {} as ComponentLoggers);

/**
 * Dedupe wrapper for repetitive log lines (poller ticks, connkey churn).
 * Within `windowMs` of the previous emit for the same `key`, the body is
 * suppressed; the next emit after the window includes a "(+N suppressed)"
 * suffix so the count is preserved in the visible record.
 *
 * Usage:
 *   log.dedupe('connkey-regen', 5000, (suffix) =>
 *     log.monitor(`Regenerating connkey${suffix}`, LogLevel.INFO, { monitorId }),
 *   );
 */
function logDedupe(
  key: string,
  windowMs: number,
  emit: (suffix: string) => void,
): void {
  const gate = logger.dedupeGate(key, windowMs);
  if (!gate) return;
  const suffix = gate.suppressed > 0 ? ` (+${gate.suppressed} suppressed)` : '';
  emit(suffix);
}

export const log = {
  debug: (message: string, context?: LogContext, ...args: unknown[]) =>
    logger.debug(message, context, ...args),
  info: (message: string, context?: LogContext, ...args: unknown[]) =>
    logger.info(message, context, ...args),
  warn: (message: string, context?: LogContext, ...args: unknown[]) =>
    logger.warn(message, context, ...args),
  error: (message: string, context?: LogContext, error?: Error | unknown, ...args: unknown[]) =>
    logger.error(message, context, error, ...args),
  dedupe: logDedupe,
  groupCollapsed: (componentName: string, message: string, level: LogLevel, body: unknown) =>
    logger.groupCollapsed(componentName, message, level, body),

  // Component-specific loggers (generated dynamically)
  ...generatedComponentLoggers,
};

// Dev-only: expose a small global so e2e tests can trigger sample log entries.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__zmng_test_log = (component: string) => {
    log.app(`test sample from ${component}`, LogLevel.INFO);
  };
}
