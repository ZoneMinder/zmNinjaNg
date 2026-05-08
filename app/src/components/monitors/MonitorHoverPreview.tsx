/**
 * Monitor Hover Preview
 *
 * Desktop-only wrapper that shows an enlarged live MJPEG stream of a
 * monitor on hover. Each open generates a fresh connkey via
 * `useStreamLifecycle`; closing the preview unmounts the inner component
 * which sends CMD_QUIT to tear down the extra stream on the ZM server.
 */

import { useRef, type ReactNode } from 'react';
import { getStreamUrl } from '../../api/monitors';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useStreamLifecycle } from '../../hooks/useStreamLifecycle';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { parseMonitorRotation } from '../../lib/monitor-rotation';
import { log } from '../../lib/logger';
import type { Monitor } from '../../api/types';
import { HoverPreview } from '../ui/hover-preview';
import { VideoOff } from 'lucide-react';

interface MonitorHoverPreviewProps {
  monitor: Monitor;
  children: ReactNode;
}

function computeNumericAspectRatio(monitor: Monitor): number {
  const w = Number(monitor.Width);
  const h = Number(monitor.Height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return 16 / 9;
  }
  const rotation = parseMonitorRotation(monitor.Orientation);
  if (rotation.kind === 'degrees') {
    const normalized = ((rotation.degrees % 360) + 360) % 360;
    if (normalized === 90 || normalized === 270) return h / w;
  }
  return w / h;
}

export function MonitorHoverPreview({ monitor, children }: MonitorHoverPreviewProps) {
  const aspectRatio = computeNumericAspectRatio(monitor);

  return (
    <HoverPreview
      aspectRatio={aspectRatio}
      testId="monitor-hover-preview"
      renderPreview={() => <MonitorLivePreview monitor={monitor} />}
    >
      {children}
    </HoverPreview>
  );
}

/**
 * Live stream body — only mounted while the preview is open.
 * Mount → new connkey. Unmount → CMD_QUIT via useStreamLifecycle.
 */
function MonitorLivePreview({ monitor }: { monitor: Monitor }) {
  const { currentProfile } = useCurrentProfile();
  const { token: accessToken, isFresh: isAccessTokenFresh } = useFreshAccessToken();
  const imgRef = useRef<HTMLImageElement>(null);

  const { connKey } = useStreamLifecycle({
    monitorId: monitor.Id,
    monitorName: monitor.Name,
    portalUrl: currentProfile?.portalUrl,
    accessToken,
    viewMode: 'streaming',
    mediaRef: imgRef,
    logFn: log.monitor,
    enabled: true,
    minStreamingPort: currentProfile?.minStreamingPort,
  });

  if (!currentProfile || connKey === 0 || !isAccessTokenFresh) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted/30">
        <VideoOff className="h-8 w-8 text-muted-foreground/40" />
      </div>
    );
  }

  const streamUrl = getStreamUrl(currentProfile.cgiUrl, monitor.Id, {
    mode: 'jpeg',
    token: accessToken || undefined,
    connkey: connKey,
    minStreamingPort: currentProfile.minStreamingPort,
  });

  return (
    <img
      ref={imgRef}
      src={streamUrl}
      alt={monitor.Name}
      className="w-full h-full object-contain bg-black"
    />
  );
}
