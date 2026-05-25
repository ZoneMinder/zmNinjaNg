/**
 * useGo2RTCStream Hook Tests
 *
 * Tests Go2RTC streaming lifecycle management and error handling.
 * Video-rtc handles protocol negotiation internally (WebRTC+MSE or WebRTC+HLS in parallel).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useGo2RTCStream } from '../useGo2RTCStream';

// Mock logger
vi.mock('../../lib/logger', () => ({
  log: {
    videoPlayer: vi.fn(),
    http: vi.fn(),
  },
  LogLevel: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
  },
}));

// Mock VideoRTC - use factory function
vi.mock('../../lib/vendor/go2rtc/video-rtc', () => ({
  VideoRTC: vi.fn().mockImplementation(function (this: any) {
    this.mode = '';
    this.media = '';
    this.src = '';
    this.oninit = vi.fn();
    this.onconnect = vi.fn();
    this.ondisconnect = vi.fn();
    this.onopen = vi.fn();
    this.onclose = vi.fn();
    this.onpcvideo = vi.fn();
    this.play = vi.fn().mockResolvedValue(undefined);
    this.appendChild = vi.fn();
    this.parentNode = null;
    return this;
  }),
}));

// Import after mocks
import { VideoRTC } from '../../lib/vendor/go2rtc/video-rtc';

// Track instances created
const mockVideoRtcInstances: any[] = [];

describe('useGo2RTCStream', () => {
  let containerElement: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVideoRtcInstances.splice(0); // Clear array

    // Reset mock implementation
    (VideoRTC as any).mockImplementation(function (this: any) {
      this.mode = '';
      this.media = '';
      this.src = '';
      this.style = {};
      this.background = false;
      this.oninit = vi.fn();
      this.onconnect = vi.fn();
      this.ondisconnect = vi.fn();
      this.onopen = vi.fn();
      this.onclose = vi.fn();
      this.onpcvideo = vi.fn();
      this.play = vi.fn().mockResolvedValue(undefined);
      this.parentNode = null;
      mockVideoRtcInstances.push(this);
      return this;
    });

    // Create mock container element
    containerElement = document.createElement('div');
    // Mock innerHTML setter to track clearing
    Object.defineProperty(containerElement, 'innerHTML', {
      set: vi.fn(),
      get: () => '',
      configurable: true,
    });
    // Mock appendChild to actually add the child
    containerElement.appendChild = vi.fn().mockImplementation((child: any) => {
      child.parentNode = containerElement;
      return child;
    });
    // Mock removeChild to handle cleanup
    containerElement.removeChild = vi.fn().mockImplementation((child: any) => {
      child.parentNode = null;
      return child;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Connection lifecycle', () => {
    it('starts in idle state when disabled', () => {
      const containerRef = { current: containerElement };
      const { result } = renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: false,
        })
      );

      expect(result.current.state).toBe('idle');
      expect(result.current.error).toBeNull();
    });

    it('connects when enabled', async () => {
      const containerRef = { current: containerElement };
      const { result } = renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
        })
      );

      // Should transition to connecting
      await waitFor(() => {
        expect(result.current.state).toBe('connecting');
      });

      // Simulate successful WebSocket open (which triggers 'connected' state)
      if (mockVideoRtcInstances.length > 0) {
        const instance = mockVideoRtcInstances[0];
        act(() => {
          // onopen is called when WebSocket opens - this triggers 'connected' state
          instance.onopen();
        });

        await waitFor(() => {
          expect(result.current.state).toBe('connected');
        });
      }
    });

    it('configures VideoRTC with all protocols', async () => {
      const containerRef = { current: containerElement };
      renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
        })
      );

      await waitFor(() => {
        expect(VideoRTC).toHaveBeenCalled();
      });

      const instance = mockVideoRtcInstances[0];
      // Video-rtc handles protocol negotiation - mode should include all protocols
      expect(instance.mode).toBe('webrtc,mse,hls');
      expect(instance.media).toBe('video,audio');
      expect(instance.src).toContain('ws://localhost:1984/ws');
      expect(instance.src).toContain('src=1_0');
    });

    it('respects custom protocol order', async () => {
      const containerRef = { current: containerElement };
      renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          protocols: ['mse', 'hls'],
          enabled: true,
        })
      );

      await waitFor(() => {
        expect(VideoRTC).toHaveBeenCalled();
      });

      const instance = mockVideoRtcInstances[0];
      expect(instance.mode).toBe('mse,hls');
    });

    it('includes token in WebSocket URL when provided', async () => {
      const containerRef = { current: containerElement };
      renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          token: 'test-token',
          enabled: true,
        })
      );

      await waitFor(() => {
        expect(VideoRTC).toHaveBeenCalled();
      });

      const instance = mockVideoRtcInstances[0];
      expect(instance.src).toContain('token=test-token');
    });

    it('cleans up on unmount', async () => {
      const containerRef = { current: containerElement };
      const { unmount } = renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
        })
      );

      await waitFor(() => {
        expect(VideoRTC).toHaveBeenCalled();
      });

      const instance = mockVideoRtcInstances[0];
      // Cleanup calls ondisconnect() to properly close WebSocket and WebRTC connections
      const ondisconnect = vi.spyOn(instance, 'ondisconnect');

      unmount();

      await waitFor(() => {
        expect(ondisconnect).toHaveBeenCalled();
      });
    });
  });

  describe('Staggered connection', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('delays connect by staggerIndex * 100ms on top of the base delay', async () => {
      vi.useFakeTimers();
      const containerRef = { current: containerElement };
      renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
          staggerIndex: 2,
        })
      );

      // Base delay (100ms) + 2 * 100ms stagger = 300ms total.
      // At 250ms nothing should have connected yet.
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(VideoRTC).not.toHaveBeenCalled();

      // After the full 300ms the connection should start.
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(VideoRTC).toHaveBeenCalled();
    });

    it('connects after the base delay when staggerIndex is 0 (single view)', async () => {
      vi.useFakeTimers();
      const containerRef = { current: containerElement };
      renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
        })
      );

      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(VideoRTC).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('sets error state when WebSocket fails to connect', async () => {
      const containerRef = { current: containerElement };
      const { result } = renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
        })
      );

      await waitFor(() => {
        expect(VideoRTC).toHaveBeenCalled();
      });

      // Simulate WebSocket close before connection established
      const instance = mockVideoRtcInstances[0];
      act(() => {
        // onclose returns false to prevent auto-reconnect when WS never connected
        instance.onclose();
      });

      await waitFor(() => {
        expect(result.current.state).toBe('error');
        expect(result.current.error).toContain('WebSocket');
      });
    });

    it('handles missing container ref gracefully', async () => {
      const containerRef = { current: null };
      const { result } = renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef: containerRef as any,
          enabled: true,
        })
      );

      // Should not attempt connection
      expect(result.current.state).toBe('idle');
      expect(VideoRTC).not.toHaveBeenCalled();
    });
  });

  describe('Retry and stop', () => {
    it('retry reconnects', async () => {
      const containerRef = { current: containerElement };
      const { result } = renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
        })
      );

      await waitFor(() => {
        expect(result.current.state).toBe('connecting');
      });

      // Get initial instance count
      const initialCount = mockVideoRtcInstances.length;

      // Manually trigger retry
      act(() => {
        result.current.retry();
      });

      await waitFor(() => {
        // Should create a new VideoRTC instance
        expect(mockVideoRtcInstances.length).toBeGreaterThan(initialCount);
      });
    });

    it('stop cleans up and resets state', async () => {
      const containerRef = { current: containerElement };
      const { result } = renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
        })
      );

      await waitFor(() => {
        expect(VideoRTC).toHaveBeenCalled();
      });

      act(() => {
        result.current.stop();
      });

      await waitFor(() => {
        expect(result.current.state).toBe('idle');
        expect(result.current.error).toBeNull();
      });
    });
  });

  describe('Video element access', () => {
    it('returns null when no video element exists', async () => {
      const containerRef = { current: containerElement };
      const { result } = renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: false,
        })
      );

      expect(result.current.getVideoElement()).toBeNull();
    });

    it('returns video element when available', async () => {
      const containerRef = { current: containerElement };
      const mockVideoElement = document.createElement('video');

      // Update mock to include video element
      (VideoRTC as any).mockImplementation(function (this: any) {
        this.mode = '';
        this.media = '';
        this.src = '';
        this.style = {};
        this.background = false;
        this.video = mockVideoElement;
        this.oninit = vi.fn();
        this.onconnect = vi.fn();
        this.ondisconnect = vi.fn();
        this.onopen = vi.fn();
        this.onclose = vi.fn();
        this.onpcvideo = vi.fn();
        this.play = vi.fn().mockResolvedValue(undefined);
        this.parentNode = null;
        mockVideoRtcInstances.push(this);
        return this;
      });

      const { result } = renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
        })
      );

      await waitFor(() => {
        expect(VideoRTC).toHaveBeenCalled();
      });

      // Should return the video element
      expect(result.current.getVideoElement()).toBe(mockVideoElement);
    });
  });

  describe('State transitions', () => {
    it('transitions: idle → connecting → connected', async () => {
      const containerRef = { current: containerElement };
      const { result } = renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
        })
      );

      // Hook connects immediately when enabled=true, so state should already be 'connecting' or 'idle'
      // Just verify it transitions to connecting (may already be there)
      await waitFor(() => {
        expect(result.current.state).toBe('connecting');
      });

      const instance = mockVideoRtcInstances[0];
      act(() => {
        // onopen triggers 'connected' state (called when WebSocket opens)
        instance.onopen();
      });

      await waitFor(() => {
        expect(result.current.state).toBe('connected');
      });
    });

    it('transitions to disconnected on ondisconnect', async () => {
      const containerRef = { current: containerElement };
      const { result } = renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
        })
      );

      await waitFor(() => {
        expect(VideoRTC).toHaveBeenCalled();
      });

      const instance = mockVideoRtcInstances[0];
      act(() => {
        // onopen triggers 'connected' state
        instance.onopen();
      });

      await waitFor(() => {
        expect(result.current.state).toBe('connected');
      });

      act(() => {
        instance.ondisconnect();
      });

      await waitFor(() => {
        expect(result.current.state).toBe('disconnected');
      });
    });
  });
});
