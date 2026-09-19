/**
 * Event Utilities
 *
 * Shared utilities for event list and montage views.
 */

import { parseMonitorRotation } from '../monitor/monitor-rotation';
import type { Monitor, ProfileId } from '../../api/types';

/**
 * Calculate maximum grid columns based on container width and minimum card width.
 *
 * @param width - Container width in pixels
 * @param minWidth - Minimum card width in pixels
 * @param gap - Gap between cards in pixels
 * @returns Maximum number of columns that can fit
 */
export const getMaxColsForWidth = (width: number, minWidth: number, gap: number): number => {
  if (width <= 0) return 1;
  const maxCols = Math.floor((width + gap) / (minWidth + gap));
  return Math.max(1, maxCols);
};

/**
 * Calculate thumbnail dimensions that preserve monitor aspect ratio.
 *
 * For rotated monitors (90°/270°), we swap width/height because:
 * - The monitor's W/H are reported in its native orientation
 * - ZoneMinder rotates the snapshot image
 * - We need to request dimensions matching the rotated snapshot
 *
 * @param monitorWidth - Monitor's actual width in pixels
 * @param monitorHeight - Monitor's actual height in pixels
 * @param orientation - Monitor's orientation (rotation)
 * @param targetSize - Target size for the larger dimension (e.g., 160, 300)
 * @param scale - Scale multiplier for high-DPI displays (default: 2)
 * @returns Thumbnail dimensions that preserve aspect ratio and account for rotation
 */
export const calculateThumbnailDimensions = (
  monitorWidth: number,
  monitorHeight: number,
  orientation: string | null | undefined,
  targetSize: number,
  scale: number = 2
): { width: number; height: number } => {
  // Check if monitor is rotated 90 or 270 degrees
  const rotation = parseMonitorRotation(orientation);
  const isRotated =
    rotation.kind === 'degrees' &&
    (((rotation.degrees % 360) + 360) % 360 === 90 || ((rotation.degrees % 360) + 360) % 360 === 270);

  // If rotated, swap width and height for aspect ratio calculation
  // This matches the rotated snapshot image from ZoneMinder
  const effectiveWidth = isRotated ? monitorHeight : monitorWidth;
  const effectiveHeight = isRotated ? monitorWidth : monitorHeight;

  // Calculate aspect ratio
  const aspectRatio = effectiveWidth / effectiveHeight;

  // Calculate thumbnail dimensions preserving aspect ratio
  // Fit to targetSize on the larger dimension
  let thumbWidth: number;
  let thumbHeight: number;

  if (aspectRatio >= 1) {
    // Landscape or square: width is larger
    thumbWidth = targetSize;
    thumbHeight = Math.round(targetSize / aspectRatio);
  } else {
    // Portrait: height is larger
    thumbHeight = targetSize;
    thumbWidth = Math.round(targetSize * aspectRatio);
  }

  // Apply scale for high-DPI displays (2x by default)
  return {
    width: Math.round(thumbWidth * scale),
    height: Math.round(thumbHeight * scale),
  };
};

/**
 * Parse monitor dimensions from a Monitor record, falling back to provided
 * strings (e.g. from an event record) and then to the given numeric defaults.
 *
 * @param monitor - Monitor record, or undefined if not found
 * @param fallbackWidth - Width string to use when monitor record is absent (e.g. event.Width)
 * @param fallbackHeight - Height string to use when monitor record is absent (e.g. event.Height)
 * @param defaultWidth - Numeric fallback when neither monitor nor fallback string is available
 * @param defaultHeight - Numeric fallback when neither monitor nor fallback string is available
 * @returns Parsed integer width and height
 */
export const getMonitorDimensions = (
  monitor: Monitor | undefined,
  fallbackWidth = '',
  fallbackHeight = '',
  defaultWidth = 640,
  defaultHeight = 480
): { width: number; height: number } => {
  return {
    width: parseInt(monitor?.Width || fallbackWidth || String(defaultWidth), 10),
    height: parseInt(monitor?.Height || fallbackHeight || String(defaultHeight), 10),
  };
};

/**
 * Build an id -> Monitor lookup from a scoped monitors list, shared by
 * EventListView and EventMontageView (refs #337 Task 2 fix round 1 - was
 * duplicated verbatim in both files' `useMemo` bodies).
 *
 * All mode: also keyed by `${profileId}:${monitorId}` so a colliding numeric
 * id across two servers doesn't collapse into one entry. Single mode: every
 * monitor's profileId is undefined, so only the bare id is set, unchanged.
 */
export function buildMonitorMap(
  monitors: Array<{ Monitor: Monitor; profileId?: ProfileId }>
): Map<string, Monitor> {
  const map = new Map<string, Monitor>();
  for (const m of monitors) {
    map.set(m.Monitor.Id, m.Monitor);
    if (m.profileId) map.set(`${m.profileId}:${m.Monitor.Id}`, m.Monitor);
  }
  return map;
}

/**
 * Grid layout constants for event montage views.
 */
export const EVENT_GRID_CONSTANTS = {
  GAP: 16,
  MIN_CARD_WIDTH: 50,
  LIST_VIEW_TARGET_SIZE: 160,
  MONTAGE_VIEW_TARGET_SIZE: 300,
  HI_DPI_SCALE: 2,
} as const;
