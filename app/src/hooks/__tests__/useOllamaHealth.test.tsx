import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { useOllamaHealth } from '../useOllamaHealth';

const mockProfile = vi.hoisted(() => ({
  value: {
    currentProfile: { id: 'p1' },
    settings: {
      assistantBackend: 'ollama' as string,
      assistantOllamaBaseUrl: 'http://localhost:11434/v1',
    },
  },
}));

vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => mockProfile.value,
  useProfileById: () => ({ profile: mockProfile.value.currentProfile, settings: mockProfile.value.settings }),
}));

vi.mock('../useBandwidthSettings', () => ({
  useBandwidthSettings: () => ({ assistantHealthInterval: 30000 }),
}));

vi.mock('../../lib/security/secureStorage', () => ({
  getSecureValue: vi.fn(async () => undefined),
}));

const listOpenAiModels = vi.hoisted(() => vi.fn());
vi.mock('../../lib/assistant/providers/openai', () => ({
  listOpenAiModels: (...args: unknown[]) => listOpenAiModels(...args),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

describe('useOllamaHealth', () => {
  beforeEach(() => {
    listOpenAiModels.mockReset();
    mockProfile.value = {
      currentProfile: { id: 'p1' },
      settings: {
        assistantBackend: 'ollama',
        assistantOllamaBaseUrl: 'http://localhost:11434/v1',
      },
    };
  });

  it('reports connected when the reachability probe resolves', async () => {
    listOpenAiModels.mockResolvedValue(['qwen3']);
    const { result } = renderHook(() => useOllamaHealth(), { wrapper });

    expect(result.current.enabled).toBe(true);
    await waitFor(() => expect(result.current.status).toBe('connected'));
  });

  it('reports disconnected when the probe throws', async () => {
    listOpenAiModels.mockRejectedValue(new Error('unreachable'));
    const { result } = renderHook(() => useOllamaHealth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('disconnected'));
  });

  it('is disabled (dot hidden) when the backend is on-device', () => {
    mockProfile.value.settings.assistantBackend = 'on-device';
    const { result } = renderHook(() => useOllamaHealth(), { wrapper });

    expect(result.current.enabled).toBe(false);
    expect(listOpenAiModels).not.toHaveBeenCalled();
  });

  it('probes the configured base URL with the short reachability timeout', async () => {
    listOpenAiModels.mockResolvedValue([]);
    const { result } = renderHook(() => useOllamaHealth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('connected'));
    // Reachable-but-empty is still connected, and the probe hits the base URL.
    expect(listOpenAiModels).toHaveBeenCalledWith('http://localhost:11434/v1', undefined, 8000);
  });
});
