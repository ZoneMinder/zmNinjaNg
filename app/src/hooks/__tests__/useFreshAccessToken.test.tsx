import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../lib/logger', () => ({
  log: {
    auth: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

vi.mock('../../api/auth', () => ({
  login: vi.fn(),
  refreshToken: vi.fn(),
}));

import { useFreshAccessToken } from '../useFreshAccessToken';
import { useAuthStore } from '../../stores/auth';

describe('useFreshAccessToken', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      accessTokenExpires: null,
      refreshToken: null,
      refreshTokenExpires: null,
      isAuthenticated: false,
    });
  });

  it('returns isFresh=true with the token when expiry is comfortably ahead', () => {
    useAuthStore.setState({
      accessToken: 'fresh',
      accessTokenExpires: Date.now() + 60 * 60 * 1000, // 1 hour
      isAuthenticated: true,
    });
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(true);
    expect(result.current.token).toBe('fresh');
  });

  it('returns isFresh=false with token=null when expiry is below the leeway', () => {
    useAuthStore.setState({
      accessToken: 'stale',
      accessTokenExpires: Date.now() + 5 * 60 * 1000, // 5 min, under 30-min leeway
      isAuthenticated: true,
    });
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(false);
    expect(result.current.token).toBeNull();
  });

  it('returns isFresh=false when there is no token', () => {
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(false);
    expect(result.current.token).toBeNull();
  });

  it('triggers getFreshAccessToken when not fresh', () => {
    const spy = vi.fn(async () => 'new');
    useAuthStore.setState({
      accessToken: 'stale',
      accessTokenExpires: Date.now() + 5 * 60 * 1000,
      isAuthenticated: true,
      getFreshAccessToken: spy as never,
    });
    renderHook(() => useFreshAccessToken());
    expect(spy).toHaveBeenCalled();
  });

  it('does not retrigger refresh while fresh', () => {
    const spy = vi.fn(async () => 'tok');
    useAuthStore.setState({
      accessToken: 'tok',
      accessTokenExpires: Date.now() + 60 * 60 * 1000,
      isAuthenticated: true,
      getFreshAccessToken: spy as never,
    });
    const { rerender } = renderHook(() => useFreshAccessToken());
    rerender();
    rerender();
    expect(spy).not.toHaveBeenCalled();
  });

  it('flips to fresh when accessTokenExpires updates', () => {
    useAuthStore.setState({
      accessToken: 'old',
      accessTokenExpires: Date.now() + 5 * 60 * 1000,
      isAuthenticated: true,
    });
    const { result } = renderHook(() => useFreshAccessToken());
    expect(result.current.isFresh).toBe(false);
    act(() => {
      useAuthStore.setState({
        accessToken: 'new',
        accessTokenExpires: Date.now() + 60 * 60 * 1000,
      });
    });
    expect(result.current.isFresh).toBe(true);
    expect(result.current.token).toBe('new');
  });
});
