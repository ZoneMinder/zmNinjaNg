import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeState, getStates } from '../states';
import { getApiClient } from '../client';
import type { ApiClient } from '../client';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../client', () => ({
  getApiClient: vi.fn(),
}));

describe('States API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getApiClient).mockReturnValue({
      get: mockGet,
      post: mockPost,
    } as unknown as ApiClient);
  });

  it('unwraps and normalizes state data', async () => {
    mockGet.mockResolvedValue({
      data: {
        states: [
          { State: { Id: 1, Name: 'Active', Definition: 'Active mode', IsActive: 1 } },
          { State: { Id: 2, Name: 'Idle', Definition: 'Idle mode', IsActive: 0 } },
        ],
      },
    });

    const states = await getStates();

    expect(mockGet).toHaveBeenCalledWith('/states.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(states).toEqual([
      { Id: '1', Name: 'Active', Definition: 'Active mode', IsActive: '1' },
      { Id: '2', Name: 'Idle', Definition: 'Idle mode', IsActive: '0' },
    ]);
  });

  it('changes state by name', async () => {
    mockPost.mockResolvedValue({});

    await changeState('Active');

    expect(mockPost).toHaveBeenCalledWith('/states/change/Active.json');
  });
});
