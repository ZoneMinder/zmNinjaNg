import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteEvent,
  getEvent,
  getEvents,
  getMonitorEventsSince,
  setEventArchived,
} from '../events';
import { validateApiResponse } from '../../lib/zm/api-validator';
import { getExcludedMonitorIds } from '../../lib/profile/profile-settings';
import { API_PAGINATION } from '../../lib/zmninja-ng-constants';
import { asProfileId } from '../types';
import type { ApiClient } from '../client';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();
const mockClient = { get: mockGet, putForm: mockPut, delete: mockDelete } as unknown as ApiClient;
const pid = asProfileId('p1');

vi.mock('../../lib/zm/api-validator', () => ({
  validateApiResponse: vi.fn((_, data) => data),
}));

vi.mock('../../lib/profile/profile-settings', () => {
  const getExcludedMonitorIds = vi.fn(() => [] as string[]);
  return {
    getExcludedMonitorIds,
    getExcludedMonitorIdSet: vi.fn(() => new Set(getExcludedMonitorIds())),
  };
});

vi.mock('../../lib/logger', () => ({
  log: {
    api: vi.fn(),
    warn: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

const buildEventData = (id: number, monitorId = '1', startDateTime = '2024-01-01 00:00:00') => ({
  Event: {
    Id: String(id),
    MonitorId: monitorId,
    StartDateTime: startDateTime,
    StorageId: null,
    SecondaryStorageId: null,
    Name: `Event ${id}`,
    Cause: 'Motion',
    EndDateTime: null,
    Width: '640',
    Height: '480',
    Length: '10',
    Frames: '100',
    AlarmFrames: '5',
    AlarmFrameId: '1',
    MaxScoreFrameId: '2',
    DefaultVideo: null,
    SaveJPEGs: '0',
    TotScore: '10',
    AvgScore: '1',
    MaxScore: '3',
    Archived: '0',
    Videoed: '0',
    Uploaded: '0',
    Emailed: '0',
    Messaged: '0',
    Executed: '0',
    Notes: null,
    StateId: null,
    Orientation: null,
    DiskSpace: null,
    Scheme: null,
  },
});

describe('Events API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getExcludedMonitorIds).mockReturnValue([]);
  });

  it('fetches events across pages and deduplicates', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: {
          events: [buildEventData(1), buildEventData(2)],
          pagination: {
            pageCount: 2,
            page: 1,
            current: 1,
            count: 2,
            prevPage: false,
            nextPage: true,
            limit: 100,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          events: [buildEventData(2), buildEventData(3)],
          pagination: {
            pageCount: 2,
            page: 2,
            current: 2,
            count: 2,
            prevPage: true,
            nextPage: false,
            limit: 100,
          },
        },
      });

    const response = await getEvents(mockClient, pid, { limit: 3 });

    expect(mockGet).toHaveBeenCalledWith('/events/index.json', expect.objectContaining({ params: { page: 1, limit: 100 } }));
    expect(mockGet).toHaveBeenCalledWith('/events/index.json', expect.objectContaining({ params: { page: 2, limit: 100 } }));
    expect(response.events).toHaveLength(3);
    expect(response.events.map((event) => event.Event.Id)).toEqual(['1', '2', '3']);
  });

  it('drops events belonging to excluded monitors', async () => {
    vi.mocked(getExcludedMonitorIds).mockReturnValue(['2']);
    mockGet.mockResolvedValue({
      data: {
        events: [
          buildEventData(1, '1'),
          buildEventData(2, '2'),
          buildEventData(3, '3'),
          buildEventData(4, '2'),
        ],
        pagination: {
          pageCount: 1, page: 1, current: 1, count: 4,
          prevPage: false, nextPage: false, limit: 100,
        },
      },
    });

    const response = await getEvents(mockClient, pid, { limit: 10 });

    expect(response.events.map((e) => e.Event.Id)).toEqual(['1', '3']);
    expect(response.events.every((e) => e.Event.MonitorId !== '2')).toBe(true);
  });

  it('applies filters to the events endpoint', async () => {
    mockGet.mockResolvedValue({
      data: {
        events: [buildEventData(10)],
        pagination: {
          pageCount: 1,
          page: 1,
          current: 1,
          count: 1,
          prevPage: false,
          nextPage: false,
          limit: 100,
        },
      },
    });

    await getEvents(mockClient, pid, {
      monitorId: '1,2',
      startDateTime: '2024-01-01T00:00:00',
      endDateTime: '2024-01-02T00:00:00',
      minAlarmFrames: 3,
      sort: 'StartDateTime',
      direction: 'desc',
    });

    const call = mockGet.mock.calls[0][0] as string;
    expect(call).toContain('/events/index');
    expect(call).toContain('MonitorId%3A1');
    expect(call).toContain('MonitorId%3A2');
    expect(call).toContain('StartDateTime%20%3E%3D%3A2024-01-01%2000%3A00%3A00');
    expect(call).toContain('EndDateTime%20%3C%3D%3A2024-01-02%2000%3A00%3A00');
    expect(call).toContain('AlarmFrames%20%3E%3D%3A3');
  });

  it('fetches a single event', async () => {
    mockGet.mockResolvedValue({
      data: {
        event: buildEventData(42),
      },
    });

    const event = await getEvent(mockClient, '42');

    expect(mockGet).toHaveBeenCalledWith('/events/42.json');
    expect(event.Event.Id).toBe('42');
  });

  it('archives an event using form-encoded body', async () => {
    mockPut.mockResolvedValue({ data: { message: 'Saved' } });

    await setEventArchived(mockClient, '5', true);

    expect(mockPut).toHaveBeenCalledTimes(1);
    const [url, body] = mockPut.mock.calls[0];
    expect(url).toBe('/events/5.json');
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get('Event[Archived]')).toBe('1');
  });

  it('unarchives an event using form-encoded body', async () => {
    mockPut.mockResolvedValue({ data: { message: 'Saved' } });

    await setEventArchived(mockClient, '9', false);

    const [, body] = mockPut.mock.calls[0];
    expect((body as URLSearchParams).get('Event[Archived]')).toBe('0');
  });

  it('deletes an event', async () => {
    mockDelete.mockResolvedValue({});

    await deleteEvent(mockClient, '7');

    expect(mockDelete).toHaveBeenCalledWith('/events/7.json');
  });

  it('applies notesRegexp filter to events endpoint', async () => {
    mockGet.mockResolvedValue({
      data: {
        events: [buildEventData(10)],
        pagination: {
          pageCount: 1, page: 1, current: 1, count: 1,
          prevPage: false, nextPage: false, limit: 100,
        },
      },
    });

    await getEvents(mockClient, pid, { notesRegexp: 'detected:' });

    const call = mockGet.mock.calls[0][0] as string;
    expect(call).toContain('Notes%20REGEXP%3Adetected%3A');
  });

  it('applies cause filter to events endpoint', async () => {
    mockGet.mockResolvedValue({
      data: {
        events: [buildEventData(11)],
        pagination: {
          pageCount: 1, page: 1, current: 1, count: 1,
          prevPage: false, nextPage: false, limit: 100,
        },
      },
    });

    await getEvents(mockClient, pid, { cause: 'Continuous' });

    const call = mockGet.mock.calls[0][0] as string;
    expect(call).toContain('Cause%20REGEXP%3AContinuous');
  });

  // Excluding a cause is how "hide linked recordings" is expressed: a linked
  // monitor records whenever its partner alarms, and those events crowd out
  // the ones a person went looking for (refs #493). Verified against ZM
  // 1.38.3: NOT REGEXP partitions the set exactly, and an operator ZM does not
  // know fails with a 500 rather than silently returning everything.
  it('adds a NOT REGEXP segment when a cause is excluded', async () => {
    mockGet.mockResolvedValue({
      data: {
        events: [],
        pagination: {
          page: 1, current: 0, count: 0, prevPage: false, nextPage: false, limit: 100,
        },
      },
    });

    await getEvents(mockClient, pid, { causeExclude: 'Linked' });

    const call = mockGet.mock.calls[0][0] as string;
    expect(call).toContain('Cause%20NOT%20REGEXP%3ALinked');
  });

  it('can ask for one cause and exclude another in the same query', async () => {
    mockGet.mockResolvedValue({
      data: {
        events: [],
        pagination: {
          page: 1, current: 0, count: 0, prevPage: false, nextPage: false, limit: 100,
        },
      },
    });

    await getEvents(mockClient, pid, { cause: 'Motion', causeExclude: 'Linked' });

    const call = mockGet.mock.calls[0][0] as string;
    expect(call).toContain('Cause%20REGEXP%3AMotion');
    expect(call).toContain('Cause%20NOT%20REGEXP%3ALinked');
  });

  it('adds the Archived segment when archived is set', async () => {
    mockGet.mockResolvedValue({
      data: {
        events: [buildEventData(10)],
        pagination: { pageCount: 1, page: 1, current: 1, count: 1, prevPage: false, nextPage: false, limit: 100 },
      },
    });

    await getEvents(mockClient, pid, { archived: true, monitorId: '1' });

    const call = mockGet.mock.calls[0][0] as string;
    expect(call).toContain('Archived%3A1');
    expect(call).toContain('MonitorId%3A1');
  });

  it('does not add the Archived segment when archived is false', async () => {
    mockGet.mockResolvedValue({
      data: {
        events: [buildEventData(10)],
        pagination: { pageCount: 1, page: 1, current: 1, count: 1, prevPage: false, nextPage: false, limit: 100 },
      },
    });

    await getEvents(mockClient, pid, { archived: false });

    const call = mockGet.mock.calls[0][0] as string;
    expect(call).not.toContain('Archived');
  });

  describe('eventIds (Id IN: filter)', () => {
    it('returns empty without any request when eventIds is empty', async () => {
      const response = await getEvents(mockClient, pid, { eventIds: [], limit: 100 });

      expect(mockGet).not.toHaveBeenCalled();
      expect(response.events).toEqual([]);
      expect(response.pagination.totalCount).toBe(0);
      expect(response.pagination.nextPage).toBe(false);
    });

    it('sends an Id IN: segment and reports the matched count as totalCount', async () => {
      mockGet.mockResolvedValue({
        data: {
          events: [buildEventData(201134), buildEventData(201150)],
          pagination: {
            pageCount: 1, page: 1, current: 1, count: 2,
            prevPage: false, nextPage: false, limit: 100,
          },
        },
      });

      const response = await getEvents(mockClient, pid, { eventIds: ['201134', '201150'], limit: 100 });

      const call = mockGet.mock.calls[0][0] as string;
      expect(call).toContain('Id%20IN%3A201134%2C201150');
      expect(response.events.map((e) => e.Event.Id)).toEqual(['201134', '201150']);
      // totalCount must reflect the favorite/tag set, not the server-wide event count
      expect(response.pagination.totalCount).toBe(2);
    });

    it('combines the Id IN: segment with other server filters', async () => {
      mockGet.mockResolvedValue({
        data: {
          events: [buildEventData(201134, '7')],
          pagination: {
            pageCount: 1, page: 1, current: 1, count: 1,
            prevPage: false, nextPage: false, limit: 100,
          },
        },
      });

      await getEvents(mockClient, pid, { eventIds: ['201134'], monitorId: '7', limit: 100 });

      const call = mockGet.mock.calls[0][0] as string;
      expect(call).toContain('MonitorId%3A7');
      expect(call).toContain('Id%20IN%3A201134');
    });

    it('sorts the merged matches by StartDateTime descending', async () => {
      mockGet.mockResolvedValue({
        data: {
          events: [
            buildEventData(1, '1', '2024-01-01 00:00:00'),
            buildEventData(2, '1', '2024-03-01 00:00:00'),
            buildEventData(3, '1', '2024-02-01 00:00:00'),
          ],
          pagination: {
            pageCount: 1, page: 1, current: 1, count: 3,
            prevPage: false, nextPage: false, limit: 100,
          },
        },
      });

      const response = await getEvents(mockClient, pid, { eventIds: ['1', '2', '3'], limit: 100, direction: 'desc' });

      expect(response.events.map((e) => e.Event.Id)).toEqual(['2', '3', '1']);
    });

    it('chunks large id sets across multiple requests and merges them', async () => {
      const chunkSize = API_PAGINATION.eventIdFilterChunkSize;
      const ids = Array.from({ length: chunkSize + 1 }, (_, i) => String(1000 + i));

      mockGet
        .mockResolvedValueOnce({
          data: {
            events: ids.slice(0, chunkSize).map((id) => buildEventData(Number(id))),
            pagination: {
              pageCount: 1, page: 1, current: 1, count: chunkSize,
              prevPage: false, nextPage: false, limit: 100,
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            events: [buildEventData(Number(ids[chunkSize]))],
            pagination: {
              pageCount: 1, page: 1, current: 1, count: 1,
              prevPage: false, nextPage: false, limit: 100,
            },
          },
        });

      const response = await getEvents(mockClient, pid, { eventIds: ids, limit: chunkSize + 1 });

      // Two chunks => two distinct id-filter requests
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(response.events).toHaveLength(chunkSize + 1);
      expect(response.pagination.totalCount).toBe(chunkSize + 1);
    });
  });

  describe('tagIds (Tags.Id: filter)', () => {
    it('sends one Tags.Id: query per tag and reports the merged count', async () => {
      mockGet
        .mockResolvedValueOnce({
          data: {
            events: [buildEventData(10), buildEventData(11)],
            pagination: {
              pageCount: 1, page: 1, current: 1, count: 2,
              prevPage: false, nextPage: false, limit: 100,
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            events: [buildEventData(11), buildEventData(12)],
            pagination: {
              pageCount: 1, page: 1, current: 1, count: 2,
              prevPage: false, nextPage: false, limit: 100,
            },
          },
        });

      const response = await getEvents(mockClient, pid, { tagIds: ['1', '2'], limit: 100 });

      // One request per tag.
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect((mockGet.mock.calls[0][0] as string)).toContain('Tags.Id%3A1');
      expect((mockGet.mock.calls[1][0] as string)).toContain('Tags.Id%3A2');
      // Union, de-duplicated (event 11 appears in both tags).
      expect(response.events.map((e) => e.Event.Id).sort()).toEqual(['10', '11', '12']);
      expect(response.pagination.totalCount).toBe(3);
    });

    it('combines the Tags.Id: segment with other server filters', async () => {
      mockGet.mockResolvedValue({
        data: {
          events: [buildEventData(10, '2')],
          pagination: {
            pageCount: 1, page: 1, current: 1, count: 1,
            prevPage: false, nextPage: false, limit: 100,
          },
        },
      });

      await getEvents(mockClient, pid, { tagIds: ['1'], monitorId: '2', limit: 100 });

      const call = mockGet.mock.calls[0][0] as string;
      expect(call).toContain('MonitorId%3A2');
      expect(call).toContain('Tags.Id%3A1');
    });

    it('an empty tagIds array matches nothing instead of falling through unfiltered', async () => {
      // All mode resolves a selected tag NAME into each server's own tag ids,
      // and a server that has no such tag resolves to an empty list. Answering
      // an unfiltered query there would show every event on exactly the server
      // that lacks the tag (refs #337). Same contract eventIds already has.
      const result = await getEvents(mockClient, pid, { tagIds: [], limit: 100 });

      expect(mockGet).not.toHaveBeenCalled();
      expect(result.events).toEqual([]);
      expect(result.pagination.totalCount).toBe(0);
    });
  });

  describe('getMonitorEventsSince', () => {
    it('uses the strict > operator and returns count plus newest', async () => {
      mockGet.mockResolvedValue({
        data: {
          events: [{ Event: { Id: '900', StartDateTime: '2026-07-09 14:26:47' } }],
          pagination: { pageCount: 31, page: 1, current: 1, count: 31, prevPage: false, nextPage: true },
        },
      });

      const result = await getMonitorEventsSince(mockClient, '1', '2026-07-01 00:00:00');

      expect(mockGet).toHaveBeenCalledWith(
        `/events/index/MonitorId%3A1/${encodeURIComponent('StartDateTime >:2026-07-01 00:00:00')}.json`,
        expect.objectContaining({
          params: { limit: 1, sort: 'StartDateTime', direction: 'desc' },
        })
      );
      expect(result).toEqual({ count: 31, newest: '2026-07-09 14:26:47' });
    });

    it('omits the date filter when there is no watermark', async () => {
      mockGet.mockResolvedValue({
        data: {
          events: [{ Event: { Id: '900', StartDateTime: '2026-07-09 14:26:47' } }],
          pagination: { pageCount: 1, page: 1, current: 1, count: 61, prevPage: false, nextPage: false },
        },
      });

      const result = await getMonitorEventsSince(mockClient, '1', null);

      expect(mockGet).toHaveBeenCalledWith(
        '/events/index/MonitorId%3A1.json',
        expect.objectContaining({ params: { limit: 1, sort: 'StartDateTime', direction: 'desc' } })
      );
      expect(result).toEqual({ count: 61, newest: '2026-07-09 14:26:47' });
    });

    it('returns a null newest when nothing matches', async () => {
      mockGet.mockResolvedValue({
        data: {
          events: [],
          pagination: { pageCount: 0, page: 1, current: 1, count: 0, prevPage: false, nextPage: false },
        },
      });

      const result = await getMonitorEventsSince(mockClient, '1', '2099-01-01 00:00:00');

      expect(result).toEqual({ count: 0, newest: null });
    });

    it('treats a missing pagination block as zero', async () => {
      mockGet.mockResolvedValue({ data: { events: [] } });

      const result = await getMonitorEventsSince(mockClient, '1', null);

      expect(result).toEqual({ count: 0, newest: null });
    });
  });

  it('validates responses through api-validator', async () => {
    mockGet.mockResolvedValue({
      data: {
        events: [buildEventData(1)],
        pagination: {
          pageCount: 1,
          page: 1,
          current: 1,
          count: 1,
          prevPage: false,
          nextPage: false,
          limit: 100,
        },
      },
    });

    await getEvents(mockClient, pid, { limit: 1 });

    expect(validateApiResponse).toHaveBeenCalled();
  });
});
