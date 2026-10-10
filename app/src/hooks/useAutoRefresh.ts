import { useEffect, useRef } from 'react';

/**
 * Calls `tick` every `seconds` while mounted; 0 never ticks. The latest
 * `tick` runs each time, so callers can pass an inline closure without
 * restarting the timer on every render.
 */
export function useAutoRefresh(seconds: number, tick: () => void): void {
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setInterval(() => tickRef.current(), seconds * 1000);
    return () => clearInterval(id);
  }, [seconds]);
}
