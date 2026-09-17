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

/**
 * Rebuild the VideoRTC mock so its onopen reports a concrete protocol list and
 * its onpcvideo leaves pcState the way video-rtc would: OPEN when WebRTC wins
 * the priority race, CLOSED when it loses and the peer connection is torn down.
 * The hook wraps both handlers, so they must be in place before renderHook.
 */
function installProtocolMock(opts: {
  modes: string[];
  pcStateAfterOnpcvideo: number;
  video: HTMLVideoElement;
  onpcvideoSpy?: (video: HTMLVideoElement) => void;
}) {
  (VideoRTC as any).mockImplementation(function (this: any) {
    const self = this;
    self.mode = '';
    self.media = '';
    self.src = '';
    self.style = {};
    self.background = false;
    self.pcConfig = { iceServers: [] };
    self.video = opts.video;
    self.pcState = WebSocket.CLOSED;
    self.oninit = vi.fn();
    self.onconnect = vi.fn();
    self.ondisconnect = vi.fn();
    self.onopen = vi.fn(() => opts.modes);
    self.onclose = vi.fn();
    self.onpcvideo = vi.fn((video: HTMLVideoElement) => {
      opts.onpcvideoSpy?.(video);
      self.pcState = opts.pcStateAfterOnpcvideo;
    });
    self.play = vi.fn().mockResolvedValue(undefined);
    self.parentNode = null;
    mockVideoRtcInstances.push(self);
    return self;
  });
}

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
      // Mirror the STUN servers video-rtc.js hardcodes so tests can prove the
      // hook overrides them.
      this.pcConfig = {
        bundlePolicy: 'max-bundle',
        iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }],
        sdpSemantics: 'unified-plan',
      };
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
      expect(instance.src).toMatch(/[?&]src=1(&|$)/);
    });

    it('clears the vendored STUN servers from pcConfig by default so no srflx DNS lookup is attempted', async () => {
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
      // The empty iceServers list is what suppresses the "-105" STUN resolve log.
      expect(instance.pcConfig.iceServers).toEqual([]);
      // Other pcConfig fields the vendor set must be preserved.
      expect(instance.pcConfig.bundlePolicy).toBe('max-bundle');
      expect(instance.pcConfig.sdpSemantics).toBe('unified-plan');
    });

    it('advertises STUN servers on pcConfig when useStun is enabled', async () => {
      const containerRef = { current: containerElement };
      renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
          useStun: true,
        })
      );

      await waitFor(() => {
        expect(VideoRTC).toHaveBeenCalled();
      });

      const instance = mockVideoRtcInstances[0];
      // With STUN on, the pc advertises the go2rtc default STUN servers.
      expect(instance.pcConfig.iceServers).toEqual([
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
      ]);
      expect(instance.pcConfig.bundlePolicy).toBe('max-bundle');
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

    it('re-enables native teardown and removes the element on unmount so the stream cannot leak', async () => {
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
      // While streaming, background is true (keeps playing when scrolled away),
      // which disables VideoRTC's own disconnect-on-removal.
      expect(instance.background).toBe(true);
      const removeChild = vi.spyOn(containerElement, 'removeChild');

      unmount();

      await waitFor(() => {
        // Cleanup flips background off so DOM removal triggers native teardown,
        // then removes the element. Together these guarantee the WebSocket is
        // closed even if the explicit ondisconnect is missed.
        expect(instance.background).toBe(false);
        expect(removeChild).toHaveBeenCalledWith(instance);
      });
    });

    it('stops WebRTC media tracks and cancels reconnect timers on exit', async () => {
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
      // Simulate an active WebRTC stream (media flows over the peer connection,
      // surfaced as the video's srcObject) plus a scheduled reconnect.
      const track = { stop: vi.fn() };
      instance.video = {
        srcObject: { getTracks: () => [track] },
        removeAttribute: vi.fn(),
      };
      instance.reconnectTID = 12345;
      const ondisconnect = vi.spyOn(instance, 'ondisconnect');

      unmount();

      await waitFor(() => {
        expect(ondisconnect).toHaveBeenCalled();
        expect(track.stop).toHaveBeenCalled();
        expect(instance.reconnectTID).toBe(0);
      });
    });
  });

  describe('Connection delay', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('connects after the base delay, with no per-tile stagger', async () => {
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

      // Nothing connects before the base delay.
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(VideoRTC).not.toHaveBeenCalled();

      // All tiles connect together once the base delay elapses (no stagger).
      act(() => {
        vi.advanceTimersByTime(100);
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

  describe('Mute write-back (refs #463)', () => {
    function renderWithVideo(muted: boolean, onMutedChange: (m: boolean) => void) {
      const video = document.createElement('video');
      video.muted = muted;
      installProtocolMock({ modes: ['webrtc'], pcStateAfterOnpcvideo: WebSocket.OPEN, video });
      const containerRef = { current: containerElement };
      const hook = renderHook(
        (props: { muted: boolean }) =>
          useGo2RTCStream({
            go2rtcUrl: 'http://localhost:1984',
            monitorId: '1',
            containerRef,
            enabled: true,
            controls: true,
            muted: props.muted,
            onMutedChange,
          }),
        { initialProps: { muted } },
      );
      return { video, hook };
    }

    it('reports a user unmute from the native controls', async () => {
      const onMutedChange = vi.fn();
      const { video } = renderWithVideo(true, onMutedChange);
      await waitFor(() => expect(mockVideoRtcInstances.length).toBe(1));
      act(() => mockVideoRtcInstances[0].oninit());

      video.muted = false;
      video.dispatchEvent(new Event('volumechange'));

      expect(onMutedChange).toHaveBeenCalledWith(false);
    });

    it('stays quiet for its own muted writes', async () => {
      const onMutedChange = vi.fn();
      const { video, hook } = renderWithVideo(true, onMutedChange);
      await waitFor(() => expect(mockVideoRtcInstances.length).toBe(1));
      act(() => mockVideoRtcInstances[0].oninit());

      hook.rerender({ muted: false });
      video.dispatchEvent(new Event('volumechange'));

      expect(video.muted).toBe(false);
      expect(onMutedChange).not.toHaveBeenCalled();
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

    it('reports the protocol that actually carries video, not the one negotiated first', async () => {
      // video-rtc runs MSE and WebRTC in parallel. onopen() lists MSE first, but
      // onpcvideo() picks the winner: pcState === OPEN means WebRTC won.
      const video = document.createElement('video');
      installProtocolMock({ modes: ['mse', 'hls'], pcStateAfterOnpcvideo: WebSocket.OPEN, video });

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
        instance.onopen();
      });

      // onopen only knows the first mode video-rtc tried.
      await waitFor(() => {
        expect(result.current.activeProtocol).toBe('mse');
      });

      act(() => {
        instance.onpcvideo(video);
      });

      await waitFor(() => {
        expect(result.current.activeProtocol).toBe('webrtc');
      });
    });

    it('leaves the protocol at the MSE/HLS mode when WebRTC loses the priority race', async () => {
      const video = document.createElement('video');
      installProtocolMock({ modes: ['mse', 'hls'], pcStateAfterOnpcvideo: WebSocket.CLOSED, video });

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
        instance.onopen();
      });

      await waitFor(() => {
        expect(result.current.activeProtocol).toBe('mse');
      });

      act(() => {
        instance.onpcvideo(video);
      });

      // WebRTC lost, video-rtc closed the peer connection, MSE still carries video.
      await waitFor(() => {
        expect(result.current.activeProtocol).toBe('mse');
      });
    });

    it('still applies the muted state after onpcvideo has chosen the winning stream', async () => {
      const video = document.createElement('video');
      video.muted = false;
      video.volume = 1;

      // Record what the muted flag was while onpcvideo ran, to prove applyMuted
      // runs after it rather than before.
      let mutedDuringOnpcvideo: boolean | null = null;
      installProtocolMock({
        modes: ['mse', 'hls'],
        pcStateAfterOnpcvideo: WebSocket.OPEN,
        video,
        onpcvideoSpy: (v) => {
          mutedDuringOnpcvideo = v.muted;
        },
      });

      const containerRef = { current: containerElement };
      renderHook(() =>
        useGo2RTCStream({
          go2rtcUrl: 'http://localhost:1984',
          monitorId: '1',
          containerRef,
          enabled: true,
          muted: true,
        })
      );

      await waitFor(() => {
        expect(VideoRTC).toHaveBeenCalled();
      });

      const instance = mockVideoRtcInstances[0];
      act(() => {
        instance.onpcvideo(video);
      });

      // The spy ran (so the original handler was delegated to) and muting was
      // applied afterwards, not before.
      expect(mutedDuringOnpcvideo).toBe(false);
      expect(video.muted).toBe(true);
      expect(video.volume).toBe(0);
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
