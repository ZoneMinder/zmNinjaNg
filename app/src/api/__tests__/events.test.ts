import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteEvent,
  getConsoleEvents,
  getEvent,
  getEvents,
  setEventArchived,
} from '../events';
import { getApiClient } from '../client';
import { validateApiResponse } from '../../lib/api-validator';
import { getExcludedMonitorIds } from '../../lib/profile-settings';
import type { ApiClient } from '../client';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock('../client', () => ({
  getApiClient: vi.fn(),
}));

vi.mock('../../lib/api-validator', () => ({
  validateApiResponse: vi.fn((_, data) => data),
}));

vi.mock('../../lib/profile-settings', () => ({
  getExcludedMonitorIds: vi.fn(() => []),
}));

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

const buildEventData = (id: number, monitorId = '1') => ({
  Event: {
    Id: String(id),
    MonitorId: monitorId,
    StorageId: null,
    SecondaryStorageId: null,
    Name: `Event ${id}`,
    Cause: 'Motion',
    StartDateTime: '2024-01-01 00:00:00',
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
    vi.mocked(getApiClient).mockReturnValue({
      get: mockGet,
      put: mockPut,
      delete: mockDelete,
    } as unknown as ApiClient);
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

    const response = await getEvents({ limit: 3 });

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

    const response = await getEvents({ limit: 10 });

    expect(response.events.map((e) => e.Event.Id)).toEqual(['1', '3']);
    expect(response.events.every((e) => e.Event.MonitorId !== '2')).toBe(true);
  });

  it('drops console event counts for excluded monitors', async () => {
    vi.mocked(getExcludedMonitorIds).mockReturnValue(['2']);
    mockGet.mockResolvedValue({
      data: { results: { '1': 3, '2': 5, '3': 1 } },
    });

    const results = await getConsoleEvents('1 hour');

    expect(results).toEqual({ '1': 3, '3': 1 });
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

    await getEvents({
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

    const event = await getEvent('42');

    expect(mockGet).toHaveBeenCalledWith('/events/42.json');
    expect(event.Event.Id).toBe('42');
  });

  it('archives an event using form-encoded body', async () => {
    mockPut.mockResolvedValue({ data: { message: 'Saved' } });

    await setEventArchived('5', true);

    expect(mockPut).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockPut.mock.calls[0];
    expect(url).toBe('/events/5.json');
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get('Event[Archived]')).toBe('1');
    expect(config?.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('unarchives an event using form-encoded body', async () => {
    mockPut.mockResolvedValue({ data: { message: 'Saved' } });

    await setEventArchived('9', false);

    const [, body] = mockPut.mock.calls[0];
    expect((body as URLSearchParams).get('Event[Archived]')).toBe('0');
  });

  it('deletes an event', async () => {
    mockDelete.mockResolvedValue({});

    await deleteEvent('7');

    expect(mockDelete).toHaveBeenCalledWith('/events/7.json');
  });

  it('gets console events', async () => {
    mockGet.mockResolvedValue({
      data: { results: { '1': 3, '2': 5 } },
    });

    const results = await getConsoleEvents('1 hour');

    expect(mockGet).toHaveBeenCalledWith('/events/consoleEvents/1%20hour.json');
    expect(results).toEqual({ '1': 3, '2': 5 });
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

    await getEvents({ notesRegexp: 'detected:' });

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

    await getEvents({ cause: 'Continuous' });

    const call = mockGet.mock.calls[0][0] as string;
    expect(call).toContain('Cause%20REGEXP%3AContinuous');
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

    await getEvents({ limit: 1 });

    expect(validateApiResponse).toHaveBeenCalled();
  });
});
