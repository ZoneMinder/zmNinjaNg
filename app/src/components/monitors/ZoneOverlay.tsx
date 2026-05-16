/**
 * Zone Overlay Component
 *
 * Renders detection zones as semi-transparent polygon overlays
 * on top of a video player or image. Read-only visualization.
 */

import { useState, useMemo } from 'react';
import type { Zone } from '../../api/types';
import type { MonitorRotation } from '../../lib/monitor-rotation';
import {
  getZoneColor,
  alarmRGBToHex,
  coordsToSvgPointsWithTransform,
  getOrientedDimensions,
  parseZoneCoords,
  type ZoneTransform,
} from '../../lib/zone-utils';

interface ZoneOverlayProps {
  /** Array of zones to display */
  zones: Zone[];
  /** Width of the monitor in pixels (original, before rotation) */
  monitorWidth: number;
  /** Height of the monitor in pixels (original, before rotation) */
  monitorHeight: number;
  /** Monitor rotation applied to the video */
  rotation: MonitorRotation;
  /** Current monitor ID to filter zones */
  monitorId: string;
  /** Whether the overlay is visible */
  visible: boolean;
}

/**
 * ZoneOverlay component.
 * Renders zone polygons as an SVG overlay.
 */
export function ZoneOverlay({
  zones,
  monitorWidth,
  monitorHeight,
  rotation,
  monitorId,
  visible,
}: ZoneOverlayProps) {
  const [hoveredZoneId, setHoveredZoneId] = useState<number | null>(null);

  // Filter zones to only show zones for this monitor
  const filteredZones = useMemo(() => {
    return zones.filter((zone) => String(zone.MonitorId) === String(monitorId));
  }, [zones, monitorId]);

  // Calculate transformation and oriented dimensions
  const { transform, viewBoxWidth, viewBoxHeight } = useMemo(() => {
    const t: ZoneTransform = {
      rotation,
      originalWidth: monitorWidth,
      originalHeight: monitorHeight,
    };
    const oriented = getOrientedDimensions(monitorWidth, monitorHeight, rotation);
    return {
      transform: t,
      viewBoxWidth: oriented.width,
      viewBoxHeight: oriented.height,
    };
  }, [rotation, monitorWidth, monitorHeight]);

  if (!visible || filteredZones.length === 0) {
    return null;
  }

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      data-testid="zone-overlay"
    >
      {filteredZones.map((zone) => {
        const points = coordsToSvgPointsWithTransform(zone.Coords, transform);
        // Use AlarmRGB color if available, otherwise fall back to type-based color
        const color = alarmRGBToHex(zone.AlarmRGB) || getZoneColor(zone.Type);
        const isHovered = hoveredZoneId === zone.Id;

        return (
          <g key={zone.Id}>
            <polygon
              points={points}
              fill={color}
              fillOpacity={isHovered ? 0.5 : 0.3}
              stroke={color}
              strokeWidth={isHovered ? 3 : 2}
              strokeOpacity={0.8}
              className="transition-all duration-150 cursor-pointer"
              onMouseEnter={() => setHoveredZoneId(zone.Id)}
              onMouseLeave={() => setHoveredZoneId(null)}
              data-testid={`zone-polygon-${zone.Id}`}
            />
            {/* Zone label - shown on hover */}
            {isHovered && (
              <ZoneLabel zone={zone} color={color} transform={transform} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Zone label component shown on hover.
 */
function ZoneLabel({ zone, color, transform }: { zone: Zone; color: string; transform: ZoneTransform }) {
  // Calculate center of the polygon for label placement (with transformation applied)
  const center = calculatePolygonCenter(zone.Coords, transform);

  return (
    <g>
      {/* Background for readability */}
      <rect
        x={center.x - 50}
        y={center.y - 12}
        width={100}
        height={24}
        fill="rgba(0, 0, 0, 0.75)"
        rx={4}
      />
      {/* Zone name */}
      <text
        x={center.x}
        y={center.y + 5}
        textAnchor="middle"
        fill="white"
        fontSize="14"
        fontWeight="500"
        className="select-none pointer-events-none"
      >
        {zone.Name}
      </text>
      {/* Zone type indicator */}
      <circle
        cx={center.x - 40}
        cy={center.y}
        r={4}
        fill={color}
      />
    </g>
  );
}

/**
 * Calculates the centroid of a polygon from coords string, with transformation applied.
 */
function calculatePolygonCenter(coords: string, transform: ZoneTransform): { x: number; y: number } {
  const points = parseZoneCoords(coords);

  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  // Transform all points first, then calculate center
  const transformedPoints = points.map((p) => {
    const { rotation, originalWidth, originalHeight } = transform;

    if (rotation.kind !== 'degrees') {
      return p;
    }

    const degrees = ((rotation.degrees % 360) + 360) % 360;

    switch (degrees) {
      case 90:
        return { x: p.y, y: originalWidth - p.x };
      case 180:
        return { x: originalWidth - p.x, y: originalHeight - p.y };
      case 270:
        return { x: originalHeight - p.y, y: p.x };
      default:
        return p;
    }
  });

  const sumX = transformedPoints.reduce((sum, p) => sum + p.x, 0);
  const sumY = transformedPoints.reduce((sum, p) => sum + p.y, 0);

  return {
    x: Math.round(sumX / transformedPoints.length),
    y: Math.round(sumY / transformedPoints.length),
  };
}
