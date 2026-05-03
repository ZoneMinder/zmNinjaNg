import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGroups } from '../groups';
import { getApiClient } from '../client';
import { validateApiResponse } from '../../lib/api-validator';
import type { ApiClient } from '../client';

const mockGet = vi.fn();

vi.mock('../client', () => ({
  getApiClient: vi.fn(),
}));

vi.mock('../../lib/api-validator', () => ({
  validateApiResponse: vi.fn((_, data) => data),
}));

describe('Groups API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getApiClient).mockReturnValue({
      get: mockGet,
    } as unknown as ApiClient);
  });

  it('fetches groups list', async () => {
    const mockGroups = {
      groups: [
        {
          Group: { Id: '1', Name: 'Inside', ParentId: null },
          Monitor: [{ Id: '2', Name: 'Garage' }],
        },
        {
          Group: { Id: '2', Name: 'Outside', ParentId: null },
          Monitor: [{ Id: '3', Name: 'Driveway' }, { Id: '4', Name: 'Backyard' }],
        },
      ],
    };
    mockGet.mockResolvedValue({ data: mockGroups });

    const response = await getGroups();

    expect(mockGet).toHaveBeenCalledWith('/groups.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(validateApiResponse).toHaveBeenCalled();
    expect(response.groups).toHaveLength(2);
    expect(response.groups[0].Group.Name).toBe('Inside');
    expect(response.groups[0].Monitor).toHaveLength(1);
  });

  it('handles empty groups list', async () => {
    mockGet.mockResolvedValue({ data: { groups: [] } });

    const response = await getGroups();

    expect(mockGet).toHaveBeenCalledWith('/groups.json', expect.objectContaining({ intent: expect.any(String) }));
    expect(response.groups).toHaveLength(0);
  });

  it('handles groups with nested parent/child structure', async () => {
    const mockGroups = {
      groups: [
        {
          Group: { Id: '1', Name: 'All Cameras', ParentId: null },
          Monitor: [],
        },
        {
          Group: { Id: '2', Name: 'Indoor', ParentId: '1' },
          Monitor: [{ Id: '1' }],
        },
        {
          Group: { Id: '3', Name: 'Outdoor', ParentId: '1' },
          Monitor: [{ Id: '2' }],
        },
      ],
    };
    mockGet.mockResolvedValue({ data: mockGroups });

    const response = await getGroups();

    expect(response.groups).toHaveLength(3);
    expect(response.groups[0].Group.ParentId).toBeNull();
    expect(response.groups[1].Group.ParentId).toBe('1');
    expect(response.groups[2].Group.ParentId).toBe('1');
  });

  it('handles groups with no monitors', async () => {
    const mockGroups = {
      groups: [
        {
          Group: { Id: '1', Name: 'Empty Group', ParentId: null },
          Monitor: [],
        },
      ],
    };
    mockGet.mockResolvedValue({ data: mockGroups });

    const response = await getGroups();

    expect(response.groups[0].Monitor).toHaveLength(0);
  });
});
