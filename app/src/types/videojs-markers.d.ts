/**
 * TypeScript declarations for videojs-markers plugin
 *
 * Provides type definitions for the videojs-markers plugin
 * that adds timeline markers to video.js players.
 */

import type videojs from 'video.js';

/**
 * Markers plugin surface attached to a Video.js Player at runtime by the
 * videojs-markers package. The plugin does not ship type augmentation, so this
 * shape is asserted via the getMarkersPlugin helper in Mp4EventPlayer.tsx.
 */
export interface MarkersPlugin {
  (options?: MarkersOptions): MarkersPluginApi;
  removeAll?: () => void;
}

export interface MarkersPluginApi {
  removeAll?: () => void;
}

/**
 * Marker configuration for videojs-markers plugin
 */
export interface MarkerConfig {
  /** Timestamp in seconds where marker appears */
  time: number;
  /** Tooltip text displayed on hover */
  text?: string;
  /** CSS class for custom styling */
  class?: string;
  /** Custom data attached to marker */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- marker data is an extensible record with arbitrary user-defined fields
  [key: string]: any;
}

/**
 * Marker tip/tooltip configuration
 */
export interface MarkerTipConfig {
  /** Whether to display tooltips */
  display: boolean;
  /** Function to generate tooltip text from marker data */
  text?: (marker: MarkerConfig) => string;
}

/**
 * Options for videojs-markers plugin
 */
export interface MarkersOptions {
  /** Array of marker configurations */
  markers?: MarkerConfig[];
  /** Tooltip configuration */
  markerTip?: MarkerTipConfig;
  /** Callback when marker is clicked */
  onMarkerClick?: (marker: MarkerConfig) => void;
  /** Callback when marker is reached during playback */
  onMarkerReached?: (marker: MarkerConfig, index: number) => void;
}

declare module 'videojs-markers' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- videojs-markers has no official TypeScript types
  const markers: any;
  export default markers;
}
