import {
  format,
  startOfMinute,
  startOfHour,
  startOfDay,
  addSeconds,
  addMinutes,
  addHours,
  addDays,
} from 'date-fns';

import {
  LAYOUT,
  getRowY,
  getMonitorColor,
  timeToX,
  type TimelineEvent,
} from './timeline-layout';

import {
  formatAppDate,
  formatAppTime,
  formatAppTimeShort,
  type FormatSettings,
} from '../../lib/format-date-time';

import { TIMELINE } from '../../lib/zmninja-ng-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RenderViewport {
  startMs: number;
  endMs: number;
  width: number; // CSS pixels
  height: number;
  dpr: number; // devicePixelRatio — all drawing multiplied by dpr
}

export interface MonitorRow {
  id: string;
  name: string;
}

export interface TickMark {
  timeMs: number;
  label: string;
  /** Day/date label for major ticks (shown above the time label). */
  majorLabel?: string;
  isMajor: boolean;
}

interface ThemeColors {
  bg: string;
  fg: string;
  muted: string;
  mutedFg: string;
  border: string;
  accent: string;
  destructive: string;
}

// ---------------------------------------------------------------------------
// Theme colors
// ---------------------------------------------------------------------------

const DARK_DEFAULTS: ThemeColors = {
  bg: 'hsl(222.2 84% 4.9%)',
  fg: 'hsl(210 40% 98%)',
  muted: 'hsl(217.2 32.6% 17.5%)',
  mutedFg: 'hsl(215 20.2% 65.1%)',
  border: 'hsl(217.2 32.6% 17.5%)',
  accent: 'hsl(217.2 32.6% 17.5%)',
  destructive: 'hsl(0 62.8% 30.6%)',
};

function readCssVar(style: CSSStyleDeclaration, name: string): string | null {
  const v = style.getPropertyValue(name).trim();
  return v || null;
}

export function getThemeColors(el: HTMLElement): ThemeColors {
  const style = getComputedStyle(el);
  const wrap = (name: string, fallback: string): string => {
    const v = readCssVar(style, name);
    return v ? `hsl(${v})` : fallback;
  };
  return {
    bg: wrap('--background', DARK_DEFAULTS.bg),
    fg: wrap('--foreground', DARK_DEFAULTS.fg),
    muted: wrap('--muted', DARK_DEFAULTS.muted),
    mutedFg: wrap('--muted-foreground', DARK_DEFAULTS.mutedFg),
    border: wrap('--border', DARK_DEFAULTS.border),
    accent: wrap('--accent', DARK_DEFAULTS.accent),
    destructive: wrap('--destructive', DARK_DEFAULTS.destructive),
  };
}

// ---------------------------------------------------------------------------
// Tick computation
// ---------------------------------------------------------------------------

interface TickInterval {
  maxRange: number;
  step: (d: Date) => Date;
  start: (d: Date) => Date;
  labelFn: (d: Date) => string;
  majorTest: (d: Date) => boolean;
  majorLabel?: (d: Date) => string;
}

const ONE_MIN = 60_000;
const ONE_HOUR = 60 * ONE_MIN;
const ONE_DAY = 24 * ONE_HOUR;

function getTickIntervals(fmt: FormatSettings): TickInterval[] {
  const fmtTimeSec = (d: Date) => formatAppTime(d, fmt);
  const fmtTime = (d: Date) => formatAppTimeShort(d, fmt);
  const fmtDate = (d: Date) => formatAppDate(d, fmt);
  const fmtDateLong = (d: Date) => {
    const weekday = format(d, 'EEE');
    return `${weekday} ${formatAppDate(d, fmt)}`;
  };

  return [
    {
      maxRange: ONE_MIN,
      step: (d) => addSeconds(d, 5),
      start: (d) => startOfMinute(d),
      labelFn: fmtTimeSec,
      majorTest: (d) => d.getSeconds() === 0,
    },
    {
      maxRange: 5 * ONE_MIN,
      step: (d) => addSeconds(d, 15),
      start: (d) => startOfMinute(d),
      labelFn: fmtTimeSec,
      majorTest: (d) => d.getSeconds() === 0,
    },
    {
      maxRange: 15 * ONE_MIN,
      step: (d) => addMinutes(d, 1),
      start: (d) => startOfHour(d),
      labelFn: fmtTime,
      majorTest: (d) => d.getMinutes() % 5 === 0,
    },
    {
      maxRange: ONE_HOUR,
      step: (d) => addMinutes(d, 5),
      start: (d) => startOfHour(d),
      labelFn: fmtTime,
      majorTest: (d) => d.getMinutes() === 0,
    },
    {
      maxRange: 6 * ONE_HOUR,
      step: (d) => addMinutes(d, 30),
      start: (d) => startOfHour(d),
      labelFn: fmtTime,
      majorTest: (d) => d.getMinutes() === 0,
    },
    {
      maxRange: 48 * ONE_HOUR,
      step: (d) => addHours(d, 1),
      start: (d) => startOfDay(d),
      labelFn: fmtTime,
      majorTest: (d) => d.getHours() === 0,
      majorLabel: fmtDateLong,
    },
    {
      maxRange: 14 * ONE_DAY,
      step: (d) => addHours(d, 6),
      start: (d) => startOfDay(d),
      labelFn: fmtTime,
      majorTest: (d) => d.getHours() === 0,
      majorLabel: fmtDateLong,
    },
    {
      maxRange: Infinity,
      step: (d) => addDays(d, 1),
      start: (d) => startOfDay(d),
      labelFn: fmtDate,
      majorTest: (d) => d.getDay() === 1, // Monday
      majorLabel: fmtDateLong,
    },
  ];
}

/** Minimum pixel gap between the right edge of one label and the left edge of the next. */
const MIN_LABEL_GAP_PX = 16;
/** Approximate character width in pixels at LAYOUT.fontSize. */
const CHAR_WIDTH_PX = 7;

function estimateLabelWidth(tick: TickMark): number {
  const text = tick.majorLabel ?? tick.label;
  return text.length * CHAR_WIDTH_PX;
}

export function computeTicks(
  startMs: number,
  endMs: number,
  widthPx: number,
  fmt: FormatSettings,
): TickMark[] {
  const range = endMs - startMs;
  const intervals = getTickIntervals(fmt);
  const interval = intervals.find((i) => range <= i.maxRange)!;

  // Generate all ticks in the range (cap at 500 to avoid runaway)
  const allTicks: TickMark[] = [];
  let cursor = interval.start(new Date(startMs));
  while (cursor.getTime() <= endMs && allTicks.length < 500) {
    const t = cursor.getTime();
    if (t >= startMs) {
      const isMajor = interval.majorTest(cursor);
      allTicks.push({
        timeMs: t,
        label: interval.labelFn(cursor),
        majorLabel: isMajor && interval.majorLabel ? interval.majorLabel(cursor) : undefined,
        isMajor,
      });
    }
    cursor = interval.step(cursor);
  }

  // Remove overlapping labels: greedily keep ticks whose labels don't collide
  const msPerPx = range / widthPx;
  const result: TickMark[] = [];
  let lastRightPx = -Infinity;

  for (const tick of allTicks) {
    const centerPx = (tick.timeMs - startMs) / msPerPx;
    const halfWidth = estimateLabelWidth(tick) / 2;
    const leftPx = centerPx - halfWidth;

    if (leftPx >= lastRightPx + MIN_LABEL_GAP_PX) {
      result.push(tick);
      lastRightPx = centerPx + halfWidth;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Drawing: time axis
// ---------------------------------------------------------------------------

export function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  viewport: RenderViewport,
  colors: ThemeColors,
  fmt: FormatSettings,
): void {
  const { dpr, startMs, endMs, width, height } = viewport;
  const headerH = LAYOUT.headerHeight * dpr;
  const ticks = computeTicks(startMs, endMs, width, fmt);

  ctx.save();

  for (const tick of ticks) {
    const x = timeToX(tick.timeMs, startMs, endMs, width) * dpr;
    // Grid line
    ctx.strokeStyle = tick.isMajor
      ? colors.border
      : withAlpha(colors.border, 0.4);
    ctx.lineWidth = tick.isMajor ? 1 * dpr : 0.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(x, headerH);
    ctx.lineTo(x, height * dpr);
    ctx.stroke();

    // Label
    ctx.textAlign = 'center';
    if (tick.majorLabel) {
      // Two-line label: day name on top, time below
      ctx.fillStyle = colors.fg;
      ctx.font = `bold ${(LAYOUT.fontSize - 1) * dpr}px ${LAYOUT.fontFamily}`;
      ctx.textBaseline = 'bottom';
      ctx.fillText(tick.majorLabel, x, headerH / 2);
      ctx.fillStyle = colors.mutedFg;
      ctx.font = `${(LAYOUT.fontSize - 1) * dpr}px ${LAYOUT.fontFamily}`;
      ctx.textBaseline = 'top';
      ctx.fillText(tick.label, x, headerH / 2 + 2 * dpr);
    } else {
      ctx.fillStyle = tick.isMajor ? colors.fg : colors.mutedFg;
      ctx.font = `${tick.isMajor ? 'bold ' : ''}${LAYOUT.fontSize * dpr}px ${LAYOUT.fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(tick.label, x, headerH / 2);
    }
  }

  // If no tick has a major (date) label, draw the date once at top-right
  const hasMajorLabel = ticks.some((t) => t.majorLabel);
  if (!hasMajorLabel) {
    const midMs = (startMs + endMs) / 2;
    const dateStr = formatAppDate(new Date(midMs), fmt);
    ctx.fillStyle = colors.mutedFg;
    ctx.font = `${(LAYOUT.fontSize - 1) * dpr}px ${LAYOUT.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(dateStr, (width / 2) * dpr, 3 * dpr);
  }

  // Header bottom border
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(0, headerH);
  ctx.lineTo(width * dpr, headerH);
  ctx.stroke();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Drawing: swimlanes
// ---------------------------------------------------------------------------

export function drawSwimlanes(
  ctx: CanvasRenderingContext2D,
  monitors: MonitorRow[],
  viewport: RenderViewport,
  colors: ThemeColors,
): void {
  const { dpr, width } = viewport;
  const rowH = LAYOUT.rowHeight * dpr;

  ctx.save();

  for (let i = 0; i < monitors.length; i++) {
    const y = getRowY(i) * dpr;

    // Alternating background
    if (i % 2 === 1) {
      ctx.fillStyle = withAlpha(colors.muted, 0.15);
      ctx.fillRect(0, y, width * dpr, rowH);
    }

    // Row bottom border
    ctx.strokeStyle = withAlpha(colors.border, 0.3);
    ctx.lineWidth = 0.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, y + rowH);
    ctx.lineTo(width * dpr, y + rowH);
    ctx.stroke();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Drawing: events
// ---------------------------------------------------------------------------

/**
 * Convert a color string to a semi-transparent version.
 * Handles both "#hex" and "hsl(...)" formats.
 */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, '0');
    // Strip existing alpha suffix if present (8-char hex)
    const base = color.length === 9 ? color.slice(0, 7) : color;
    return `${base}${hex}`;
  }
  // hsl(H S% L%) → hsla(H, S%, L%, alpha) for canvas compatibility
  const inner = color.replace(/^hsl\(/, '').replace(/\)$/, '');
  return `hsla(${inner.replace(/\s+/g, ', ')}, ${alpha})`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

export function drawEvents(
  ctx: CanvasRenderingContext2D,
  events: TimelineEvent[],
  monitorIds: string[],
  viewport: RenderViewport,
  hoveredEventId: string | null,
  nowMs?: number,
): void {
  const { dpr, startMs, endMs, width } = viewport;
  const rowH = LAYOUT.rowHeight * dpr;
  const pad = LAYOUT.eventPadding * dpr;
  const minW = LAYOUT.eventMinWidth * dpr;
  const cornerRadius = 3 * dpr;

  ctx.save();

  const monitorIndexMap = new Map<string, number>();
  for (let i = 0; i < monitorIds.length; i++) {
    monitorIndexMap.set(monitorIds[i], i);
  }

  for (const event of events) {
    // Skip events fully outside viewport
    if (event.endMs < startMs || event.startMs > endMs) continue;

    const rowIdx = monitorIndexMap.get(event.monitorId);
    if (rowIdx === undefined) continue;

    const x1 = Math.max(
      0,
      timeToX(event.startMs, startMs, endMs, width) * dpr,
    );
    const x2 = Math.min(
      width * dpr,
      timeToX(event.endMs, startMs, endMs, width) * dpr,
    );
    let barW = x2 - x1;
    if (barW < minW) barW = minW;

    const rowTop = getRowY(rowIdx) * dpr;
    const barY = rowTop + pad;
    const barH = rowH - pad * 2;

    const color = getMonitorColor(rowIdx);
    const isHovered = event.id === hoveredEventId;

    // Hovered: shadow
    if (isHovered) {
      ctx.shadowColor = 'rgba(255,255,255,0.4)';
      ctx.shadowBlur = 8 * dpr;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    // Bar fill
    drawRoundedRect(ctx, x1, barY, barW, barH, cornerRadius);
    ctx.fillStyle = isHovered ? color : withAlpha(color, 0.85);
    ctx.fill();

    // Pulse halo for newly arrived live events (fade-out over TIMELINE.pulseDurationMs)
    if (nowMs !== undefined && event.arrivedAt !== undefined) {
      const elapsed = nowMs - event.arrivedAt;
      if (elapsed >= 0 && elapsed < TIMELINE.pulseDurationMs) {
        const progress = elapsed / TIMELINE.pulseDurationMs;
        const pulse = Math.sin(progress * Math.PI * 4) * 0.5 + 0.5;
        const fade = 1 - progress;
        const intensity = pulse * fade;

        ctx.save();
        // Draw multiple shadow layers for a strong glow
        for (let layer = 0; layer < 3; layer++) {
          ctx.shadowColor = `rgba(255, 220, 40, ${intensity})`;
          ctx.shadowBlur = (10 + pulse * 14 + layer * 6) * dpr;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          drawRoundedRect(ctx, x1 - dpr, barY - dpr, barW + 2 * dpr, barH + 2 * dpr, cornerRadius + dpr);
          ctx.strokeStyle = `rgba(255, 220, 40, ${intensity * 0.9})`;
          ctx.lineWidth = (2.5 - layer * 0.5) * dpr;
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Hovered: white outline
    if (isHovered) {
      drawRoundedRect(ctx, x1, barY, barW, barH, cornerRadius);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
    }

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // Bar label: two rows — top: detected objects or cause, bottom: Event ID
    const labelPad = 3 * dpr;
    const fontSize = (LAYOUT.fontSize - 3) * dpr;

    if (barW > 30 * dpr) {
      const maxTextW = barW - labelPad * 2;
      const objects = getDetectedObjects(event.notes);
      const topLine = objects || event.cause;
      const bottomLine = `Event ID: ${event.id}`;
      const midY = barY + barH / 2;

      ctx.font = `${fontSize}px ${LAYOUT.fontFamily}`;
      ctx.textAlign = 'left';

      // Top row
      ctx.fillStyle = '#ffffffdd';
      ctx.textBaseline = 'bottom';
      ctx.fillText(truncateText(ctx, topLine, maxTextW), x1 + labelPad, midY - 1 * dpr);

      // Bottom row
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.textBaseline = 'top';
      ctx.fillText(truncateText(ctx, bottomLine, maxTextW), x1 + labelPad, midY + 1 * dpr);
    }
  }

  ctx.restore();
}

/** Extract detected object names from Notes field, stripping text after |. */
function getDetectedObjects(notes: string | null): string {
  if (!notes) return '';
  const match = notes.match(/detected:(.*)/i);
  if (!match) return '';
  const objects = match[1]
    .split(',')
    .map((s) => s.split('|')[0].trim())
    .filter(Boolean);
  // Deduplicate
  return [...new Set(objects)].join(', ');
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1) {
    truncated = truncated.slice(0, -1);
    if (ctx.measureText(truncated + '…').width <= maxWidth) {
      return truncated + '…';
    }
  }
  return '…';
}

// ---------------------------------------------------------------------------
// Drawing: current time marker
// ---------------------------------------------------------------------------

export function drawCurrentTime(
  ctx: CanvasRenderingContext2D,
  viewport: RenderViewport,
  colors: ThemeColors,
): void {
  const { dpr, startMs, endMs, width, height } = viewport;
  const now = Date.now();
  if (now < startMs || now > endMs) return;

  const x = timeToX(now, startMs, endMs, width) * dpr;
  const headerH = LAYOUT.headerHeight * dpr;

  ctx.save();

  // Dashed red line
  ctx.strokeStyle = colors.destructive;
  ctx.lineWidth = 1.5 * dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  ctx.moveTo(x, headerH);
  ctx.lineTo(x, height * dpr);
  ctx.stroke();
  ctx.setLineDash([]);

  // "NOW" pill at top
  const pillW = 30 * dpr;
  const pillH = 16 * dpr;
  const pillX = x - pillW / 2;
  const pillY = (headerH - pillH) / 2;

  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = colors.destructive;
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${10 * dpr}px ${LAYOUT.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('NOW', x, pillY + pillH / 2);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Drawing: playhead (scrubber cursor)
// ---------------------------------------------------------------------------

export function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  viewport: RenderViewport,
  playheadMs: number,
): void {
  const { dpr, startMs, endMs, width, height } = viewport;
  if (playheadMs < startMs || playheadMs > endMs) return;

  const x = timeToX(playheadMs, startMs, endMs, width) * dpr;
  const headerH = LAYOUT.headerHeight * dpr;

  ctx.save();

  // Bright vertical line
  ctx.strokeStyle = '#60a5fa'; // blue-400
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(x, headerH);
  ctx.lineTo(x, height * dpr);
  ctx.stroke();

  // Small diamond handle at top
  const size = 5 * dpr;
  ctx.fillStyle = '#60a5fa';
  ctx.beginPath();
  ctx.moveTo(x, headerH - size);
  ctx.lineTo(x + size, headerH);
  ctx.lineTo(x, headerH + size);
  ctx.lineTo(x - size, headerH);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function renderTimeline(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  monitors: MonitorRow[],
  events: TimelineEvent[],
  monitorIds: string[],
  viewport: RenderViewport,
  hoveredEventId: string | null,
  playheadMs: number | null | undefined,
  fmt: FormatSettings,
  nowMs?: number,
): void {
  const { dpr, width, height } = viewport;
  const w = width * dpr;
  const h = height * dpr;

  // Clear and fill background
  ctx.clearRect(0, 0, w, h);

  const colors = getThemeColors(canvas);

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, w, h);

  // Draw layers in order
  drawSwimlanes(ctx, monitors, viewport, colors);
  drawTimeAxis(ctx, viewport, colors, fmt);
  drawEvents(ctx, events, monitorIds, viewport, hoveredEventId, nowMs);
  drawCurrentTime(ctx, viewport, colors);
  if (playheadMs != null) {
    drawPlayhead(ctx, viewport, playheadMs);
  }
}
