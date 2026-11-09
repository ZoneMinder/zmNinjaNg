import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getToolByName, isWithheldToolName, readOnlyTools, WITHHELD_TOOL_NAMES, TOOLS } from '../tools';
import { safeExecute, validateToolInput, objectTypePattern, coerceLabelList, matchLabels, isOmittedArg, stripOmittedArgs, objectQuestionMismatch, whenNotFromQuestion, calendarTimeframeMismatch, toolCallSignature, repairCountEventsInterval } from '../tool-helpers';
import type { ToolContext } from '../types';
import { asProfileId } from '../../../api/types';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { getEvents } from '../../../api/events';
import { getAlarmStatus, getMonitor, getMonitors } from '../../../api/monitors';
import { getStorages, getServers } from '../../../api/server';
import { DEFAULT_THUMBNAIL_FALLBACK_CHAIN } from '../../../stores/settings';
import { log } from '../../logger';
import { clearAllServerMaps, setServerMap } from '../../zm/server-resolver';
import { seedProfiles, resetProfileFixture } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';
import { getSession } from '../../../services/sessions';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

const { mockMonitor, mockMonitorStatus } = vi.hoisted(() => ({
  mockMonitor: {
    Id: '1', Name: 'Front Door', Type: 'Local', Function: 'Modect', Enabled: '1',
    Controllable: '1', ControlId: '3', Width: '1920', Height: '1080',
  },
  mockMonitorStatus: { Status: 'Connected', CaptureFPS: '5.0', AnalysisFPS: '2.0' },
}));

vi.mock('../../../api/monitors', () => ({
  getMonitors: vi.fn().mockResolvedValue({
    monitors: [{ Monitor: mockMonitor, Monitor_Status: mockMonitorStatus }],
  }),
  getMonitor: vi.fn().mockResolvedValue({
    Monitor: mockMonitor, Monitor_Status: mockMonitorStatus,
  }),
  getAlarmStatus: vi.fn().mockResolvedValue({ status: 0, output: 0 }),
  triggerAlarm: vi.fn().mockResolvedValue(undefined),
  cancelAlarm: vi.fn().mockResolvedValue(undefined),
  setMonitorEnabled: vi.fn().mockResolvedValue(undefined),
  changeMonitorFunction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../api/states', () => ({
  changeState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../api/events', () => ({
  getEvents: vi.fn().mockResolvedValue({
    events: [
      {
        Event: {
          Id: '42', MonitorId: '1', Cause: 'Motion', StartDateTime: '2026-01-01 00:00:00',
          EndDateTime: '2026-01-01 00:01:00', Length: '12.5', Frames: '30', AlarmFrames: '5',
          MaxScore: '10', AvgScore: '4', TotScore: '120', Archived: '0',
          Notes: 'detected:person,car|Motion: All',
        },
      },
    ],
    // pagination.nextPage = false: exactly one match, nothing beyond this
    // page, so list_events' `truncated` flag stays unset by default (refs #246).
    pagination: { page: 1, pageCount: 1, current: 1, count: 1, prevPage: false, nextPage: false, limit: 25, totalCount: 1 },
  }),
  getEvent: vi.fn().mockResolvedValue({
    Event: {
      Id: '42', MonitorId: '1', Cause: 'Motion', StartDateTime: '2026-01-01 00:00:00',
      EndDateTime: '2026-01-01 00:01:00', Length: '12.5', Frames: '30', AlarmFrames: '5',
      MaxScore: '10', AvgScore: '4', TotScore: '120', Archived: '0', DefaultVideo: 'video.mp4',
      Notes: 'detected:person,car|Motion: All',
    },
  }),
  getConsoleEvents: vi.fn().mockResolvedValue([{ monitorId: '1', count: 3 }]),
  deleteEvent: vi.fn().mockResolvedValue(undefined),
  setEventArchived: vi.fn().mockResolvedValue(undefined),
  // Used by lib/event/thumbnail-chain.ts's buildThumbnailChain (refs #246) when
  // a tool builds event display cards; the real impl just concatenates a URL.
  getEventImageUrl: vi.fn(
    (portalUrl: string, eventId: string, frame: string) => `${portalUrl}/index.php?view=image&eid=${eventId}&fid=${frame}`,
  ),
}));

vi.mock('../../../api/server', () => ({
  getLoad: vi.fn().mockResolvedValue({ load: 0.5 }),
  getDiskPercent: vi.fn().mockResolvedValue({ percent: 42 }),
  getDaemonCheck: vi.fn().mockResolvedValue(true),
  getStorages: vi.fn().mockResolvedValue([
    { Id: '1', Name: 'Default', DiskUsedSpace: 50, DiskTotalSpace: 100, DiskSpace: null },
  ]),
  getServers: vi.fn().mockResolvedValue([{ Id: '1', Name: 'zm1' }]),
}));

vi.mock('../../../api/auth', () => ({
  getVersion: vi.fn().mockResolvedValue({ version: '1.37.0', apiversion: '2.0' }),
}));

vi.mock('../../../api/groups', () => ({
  getGroups: vi.fn().mockResolvedValue({
    groups: [
      { Group: { Id: '1', Name: 'Outside' }, Monitor: [{ Id: '1', Name: 'Front Door' }] },
      { Group: { Id: '2', Name: 'Empty Group' }, Monitor: [] },
    ],
  }),
}));

vi.mock('../../../api/tags', async () => {
  const actual = await vi.importActual('../../../api/tags');
  return {
    ...actual,
    getTags: vi.fn().mockResolvedValue(null),
    getEventTags: vi.fn().mockResolvedValue(new Map()),
  };
});

/** Test-local interpreter stub (refs #265): in production interpretWhen is a
 *  model call; here a fixed phrase->fields map keeps executors deterministic. */
const INTERPRETED: Record<string, Record<string, unknown>> = {
  today: { daysAgo: 0 },
  yesterday: { daysAgo: 1 },
  'last hour': { lastCount: 1, lastUnit: 'hour' },
  'yesterday from 4pm to 10pm': { daysAgo: 1, fromTime: '16:00', toTime: '22:00' },
  'yesterday 10:00:00 am to 18:00:00 pm': { daysAgo: 1, fromTime: '10:00', toTime: '18:00' },
  'today 10:00:00 am to 18:00:00 pm': { daysAgo: 0, fromTime: '10:00', toTime: '18:00' },
  'yesterday afternoon': { daysAgo: 1 },
  gestern: { daysAgo: 1 },
};

function ctx(): ToolContext {
  return {
    profileId: asProfileId('p1'),
    queryClient: { fetchQuery: (o: { queryFn: () => unknown }) => o.queryFn() } as never,
    host: { navigate: vi.fn(), onActivity: vi.fn() },
    interpretWhen: vi.fn(async (phrase: string) =>
      INTERPRETED[phrase.toLowerCase()] ?? { error: `Could not interpret "${phrase}" as a time window.` },
    ),
  };
}

// Adds the image-building inputs AskPanel.tsx supplies in production (refs #246),
// so list_events/get_event/list_monitors/get_monitor can be asserted to build
// `display` result cards the same way MonitorRecentEvents.tsx builds thumbnails.
function ctxWithDisplay(): ToolContext {
  return {
    ...ctx(),
    portalUrl: 'https://zm.example.com',
    accessToken: 'tok123',
    minStreamingPort: undefined,
    thumbnailFallbackChain: DEFAULT_THUMBNAIL_FALLBACK_CHAIN,
    dateTimeFormat: { dateFormat: 'MMM d, yyyy', timeFormat: '24h', customDateFormat: '', customTimeFormat: '' },
  };
}

// Real profile store, so ctx()'s profileId 'p1' resolves through the real
// session registry; only api/* stays mocked above. The session is built here
// rather than left to the first tool call: getSession's first build for a
// profile fires a background getServers() call (server-map bootstrap) that
// would otherwise steal a test's own mockRejectedValueOnce/mockResolvedValueOnce
// queued for getServers, which real usage never sees (the session already
// exists from login by the time a tool runs).
beforeEach(() => {
  seedProfiles(['p1']);
  getSession(asProfileId('p1'));
});
afterEach(() => {
  resetProfileFixture();
  resetFakeStoreGates();
  clearAllServerMaps();
});

describe('read-only tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list_monitors returns id/name/function/enabled', async () => {
    const tool = getToolByName('list_monitors')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Front Door');
  });

  it('list_monitors includes controllable, status, and live fps', async () => {
    const tool = getToolByName('list_monitors')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const rows = JSON.parse(r.output as string);
    expect(rows[0]).toMatchObject({
      id: '1', name: 'Front Door', type: 'Local', enabled: true, controllable: true,
      controlId: '3', width: 1920, height: 1080, status: 'Connected', captureFps: 5, analysisFps: 2,
    });
  });

  // Same model habit as list_events, less dangerous outcome: getMonitor("Front
  // Door") fails at the API rather than returning an empty set, so it never
  // became a false "no". It still fails a question it could have answered.
  describe('get_monitor monitor resolution', () => {
    it('resolves a monitor NAME to its id', async () => {
      const tool = getToolByName('get_monitor')!;
      const r = await tool.execute({ monitorId: 'Front Door' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getMonitor)).toHaveBeenCalledWith(expect.anything(), '1');
    });

    it('passes a numeric id straight through without listing monitors first', async () => {
      const tool = getToolByName('get_monitor')!;
      const r = await tool.execute({ monitorId: '1' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getMonitor)).toHaveBeenCalledWith(expect.anything(), '1');
      // A bare id needs no lookup: a wrong one fails loudly at the API, which
      // is why this path can stay one request instead of two.
      expect(vi.mocked(getMonitors)).not.toHaveBeenCalled();
    });

    it('errors with the real monitor names for an unknown name', async () => {
      const tool = getToolByName('get_monitor')!;
      const r = await tool.execute({ monitorId: 'Nonexistent Cam' }, ctx());
      expect(r.isError).toBe(true);
      expect(r.output).toContain('Front Door');
      expect(vi.mocked(getMonitor)).not.toHaveBeenCalled();
    });
  });

  // A small model reliably passes the monitor NAME it saw in a previous
  // list_events/list_monitors row, not the numeric id. ZoneMinder's
  // `MonitorId:FrontDoor` filter matches nothing, so the query came back with
  // total: 0 and the model answered "no one came to your front door" about a
  // camera it had never actually queried. A false negative is the worst
  // possible failure for this app, so a name must resolve, and anything
  // unresolvable must be an error the model can see and retry, never an empty
  // result set that reads like an answer.
  describe('list_events monitor resolution', () => {
    it('resolves a monitor NAME to its id', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: 'Front Door' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ monitorId: '1' }));
    });

    it('resolves a name ignoring case and surrounding space', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: '  front door ' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ monitorId: '1' }));
    });

    // "FrontDoor" is exactly what the model sent in the real failure.
    it('resolves a name with the spaces stripped out', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: 'FrontDoor' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ monitorId: '1' }));
    });

    it('passes a valid numeric id straight through', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: '1' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ monitorId: '1' }));
    });

    it('errors, and never queries, for a monitor that does not exist', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: 'Back Garden' }, ctx());
      expect(r.isError).toBe(true);
      // Naming the real monitors gives the model what it needs to retry.
      expect(r.output).toContain('Front Door');
      expect(vi.mocked(getEvents)).not.toHaveBeenCalled();
    });

    it('errors for an id that looks numeric but matches no monitor', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ monitorId: '999' }, ctx());
      expect(r.isError).toBe(true);
      expect(vi.mocked(getEvents)).not.toHaveBeenCalled();
    });

    it('queries every monitor when none is given', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({}, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ monitorId: undefined }));
    });

    // Small models emit the literal string "null" (or "undefined"/"none"/"all")
    // for an optional arg they mean to omit. Treating that as a monitor NAME
    // threw "no monitor named null" and the model then hallucinated an answer
    // from the error. These mean "no filter", not a real monitor.
    it.each(['null', 'undefined', 'none', 'None', 'all', 'NULL', ''])(
      'treats %o as "all monitors", not a failed lookup',
      async (placeholder) => {
        const tool = getToolByName('list_events')!;
        const r = await tool.execute({ monitorId: placeholder, when: 'today' }, ctx());
        expect(r.isError).toBeFalsy();
        expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ monitorId: undefined }));
      },
    );

    it('ignores a placeholder objectType instead of matching nothing', async () => {
      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ objectType: 'null' }, ctx());
      expect(r.isError).toBeFalsy();
      expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ notesRegexp: undefined }));
    });
  });

  // Observed live: earlier turns were about yesterday, the user asked to
  // summarize today, and the carried-over phrase interpreted fine and answered
  // the wrong day with real data.
  it('list_events refuses a when phrase the question never used', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ when: 'yesterday' }, { ...ctx(), question: 'summarize today' });
    expect(r.isError).toBe(true);
    expect(r.output).toContain('summarize today');
    expect(vi.mocked(getEvents)).not.toHaveBeenCalled();
  });

  it('list_events interprets a when phrase the question did use', async () => {
    const tool = getToolByName('list_events')!;
    const context = { ...ctx(), question: 'summarize today' };
    const r = await tool.execute({ when: 'today' }, context);
    expect(r.isError).toBeFalsy();
    expect(context.interpretWhen).toHaveBeenCalledWith('today');
  });

  // The live failure (refs #270): the model rephrased "10am-6pm" as
  // "10:00:00 AM to 18:00:00 PM" - the same instants - and verbatim-substring
  // provenance rejected it into an identical-retry death loop. Token matching
  // accepts it because the canonical times line up.
  it('list_events accepts a rephrased time-range when matching the question', async () => {
    const tool = getToolByName('list_events')!;
    const context = { ...ctx(), question: 'Compare 10am-6pm yesterday and today.' };
    const r = await tool.execute({ when: 'yesterday 10:00:00 AM to 18:00:00 PM' }, context);
    expect(r.isError).toBeFalsy();
    expect(context.interpretWhen).toHaveBeenCalledWith('yesterday 10:00:00 AM to 18:00:00 PM');
  });

  // The model repeats a rejected call verbatim rather than correcting it (nine
  // identical retries to budget death, observed live). One resolved timeframe
  // whose tokens the stray `when` already CARRIES makes the right `when`
  // computable, so repair and run instead of rejecting.
  it('list_events overrides a stray when that contains the single resolved timeframe', async () => {
    const warn = vi.spyOn(log, 'assistant').mockImplementation(() => {});
    const tool = getToolByName('list_events')!;
    const context = { ...ctx(), question: 'summarize today', allowedWhenPhrases: ['yesterday'] };
    const r = await tool.execute({ when: 'yesterday afternoon' }, context);
    expect(r.isError).toBeFalsy();
    expect(context.interpretWhen).toHaveBeenCalledWith('yesterday');
    expect(warn).toHaveBeenCalledWith(
      'list_events when overridden to the resolved timeframe',
      expect.anything(),
      { from: 'yesterday afternoon', to: 'yesterday' },
    );
    warn.mockRestore();
  });

  // The wrong-day repro (refs #270): a stray `when` about a DIFFERENT day must
  // not be force-substituted with the single resolved timeframe. Containment
  // fails ("yesterday" is not in "today 10:00..."), so the call is rejected
  // rather than silently rewritten to answer the wrong day with real data.
  it('list_events rejects a stray when the resolved timeframe contradicts', async () => {
    const tool = getToolByName('list_events')!;
    const context = { ...ctx(), question: 'summarize today', allowedWhenPhrases: ['yesterday'] };
    const r = await tool.execute({ when: 'today 10:00:00 AM to 18:00:00 PM' }, context);
    expect(r.isError).toBe(true);
    expect(context.interpretWhen).not.toHaveBeenCalledWith('yesterday');
    expect(vi.mocked(getEvents)).not.toHaveBeenCalled();
  });

  // Several resolved timeframes is genuinely ambiguous: keep rejecting.
  it('list_events still rejects a stray when when several timeframes resolved', async () => {
    const tool = getToolByName('list_events')!;
    const context = { ...ctx(), question: 'summarize today', allowedWhenPhrases: ['today', 'last hour'] };
    const r = await tool.execute({ when: 'yesterday' }, context);
    expect(r.isError).toBe(true);
    expect(vi.mocked(getEvents)).not.toHaveBeenCalled();
  });

  // No stage ran (zero allowed phrases): prior reject behavior is untouched.
  it('list_events rejects a stray when when no timeframe resolved', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ when: 'yesterday' }, { ...ctx(), question: 'summarize today' });
    expect(r.isError).toBe(true);
    expect(vi.mocked(getEvents)).not.toHaveBeenCalled();
  });

  // Same repeat-a-rejection death loop, objectType edition: a question naming no
  // object gets the spurious filter dropped so the summary runs once.
  it('list_events drops an objectType the question never named', async () => {
    const warn = vi.spyOn(log, 'assistant').mockImplementation(() => {});
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ objectType: ['person'] }, { ...ctx(), question: 'summarize today' });
    expect(r.isError).toBeFalsy();
    expect(vi.mocked(getEvents)).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ notesRegexp: undefined }));
    expect(warn).toHaveBeenCalledWith(
      'list_events objectType dropped: the question names no object',
      expect.anything(),
      { dropped: 'person' },
    );
    warn.mockRestore();
  });

  it('list_events keeps an objectType the question does name', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ objectType: ['person'] }, { ...ctx(), question: 'how many people came today' });
    expect(r.isError).toBeFalsy();
    expect(vi.mocked(getEvents)).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ notesRegexp: 'detected:.*person' }),
    );
  });

  it('list_events never combines tag and event-id filters', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ tag: '5', eventIds: ['1', '2'] }, ctx());
    expect(r.isError).toBe(true);
  });

  it('list_events caps the limit at ASSISTANT.maxListEventsLimit', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ limit: 999 }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('42');
  });

  it('list_events rows carry the monitor NAME and detected objects, not a bare id', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const { events: rows } = JSON.parse(r.output as string);
    expect(rows[0]).toMatchObject({ id: '42', monitor: 'Front Door', objects: ['person', 'car'] });
  });

  // Only what an answer is built from. The fuller row was ~300 characters, so
  // 25 of them (7430) overflowed maxToolResultCharacters and the whole payload
  // was replaced by a truncation notice the model read as "no events".
  it('list_events rows carry only the fields an answer needs', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const { events: rows } = JSON.parse(r.output as string);
    expect(rows[0]).toEqual({
      id: '42', monitor: 'Front Door', start: '2026-01-01 00:00:00', durationSec: 12.5, objects: ['person', 'car'],
    });
  });

  // Supplying matchCount and countsByMonitor was not enough: asked to
  // summarize, a 3B model enumerated every row and quoted neither. The counts
  // are now written out as a sentence for it to copy.
  it('leads the result with a counts sentence the model can quote verbatim', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctx());
    const parsed = JSON.parse(r.output as string);
    expect(parsed.summary).toContain('1 event');
    expect(parsed.summary).toContain('By monitor: Front Door 1.');
    expect(parsed.summary).toContain('Detected: person 1, car 1.');
    // First key in the serialized object, so it is the first thing read.
    expect(Object.keys(parsed)[0]).toBe('summary');
  });

  it('tallies detected objects alongside the per-monitor counts', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctx());
    expect(JSON.parse(r.output as string).objectCounts).toEqual({ person: 1, car: 1 });
  });

  // The guarantee that matters: a full result must never exceed the budget,
  // because safeExecute's fallback destroys the payload rather than trimming it.
  it('keeps a full-size result inside the tool result budget', async () => {
    const many = Array.from({ length: ASSISTANT.maxListEventsLimit }, (_, i) => ({
      Event: {
        Id: String(1000 + i), MonitorId: '1', Cause: 'Motion',
        StartDateTime: '2026-01-01 00:00:00', EndDateTime: '2026-01-01 00:01:00',
        Length: '12.5', Frames: '30', AlarmFrames: '5', MaxScore: '10', AvgScore: '4',
        Archived: '0', Notes: 'detected:person,car|Motion: All',
      },
    }));
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: many as never,
      pagination: { page: 1, pageCount: 1, current: 1, count: many.length, prevPage: false, nextPage: false, limit: 25, totalCount: many.length },
    } as never);
    const tool = getToolByName('list_events')!;

    const r = await tool.execute({}, ctx());

    expect(r.output.length).toBeLessThanOrEqual(ASSISTANT.maxToolResultCharacters);
    // Still real JSON with rows in it, not a truncation envelope.
    expect(JSON.parse(r.output).events.length).toBeGreaterThan(0);
  });

  it('list_events builds an event display card with imageUrls, capped to the same rows as output (refs #246)', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctxWithDisplay());
    expect(r.isError).toBeFalsy();
    const { events: rows } = JSON.parse(r.output as string);
    expect(r.display).toHaveLength(rows.length);
    expect(r.display![0]).toMatchObject({ kind: 'event', id: '42', navigatePath: '/events/42' });
    expect(r.display![0].imageUrls!.length).toBeGreaterThan(0);
    expect(r.display![0].imageUrls![0]).toContain('http');
    // The model-facing output string must never carry image URLs (vision non-goal).
    expect(r.output).not.toContain('http');
  });

  it('list_monitors builds a monitor display card with no imageUrls (refs #246)', async () => {
    const tool = getToolByName('list_monitors')!;
    const r = await tool.execute({}, ctxWithDisplay());
    expect(r.isError).toBeFalsy();
    expect(r.display).toHaveLength(1);
    expect(r.display![0]).toMatchObject({ kind: 'monitor', id: '1', navigatePath: '/monitors/1' });
    expect(r.display![0].imageUrls).toBeUndefined();
    expect(r.output).not.toContain('http');
  });

  it('get_monitor builds a monitor display card with no imageUrls (refs #246)', async () => {
    const tool = getToolByName('get_monitor')!;
    const r = await tool.execute({ monitorId: '1' }, ctxWithDisplay());
    expect(r.isError).toBeFalsy();
    expect(r.display).toHaveLength(1);
    expect(r.display![0]).toMatchObject({ kind: 'monitor', id: '1', navigatePath: '/monitors/1' });
    expect(r.display![0].imageUrls).toBeUndefined();
    expect(r.output).not.toContain('http');
  });

  it("get_monitor reads alarm status from the monitor's own server", async () => {
    setServerMap(new Map([['2', { recordingUrl: '', portalPath: '', apiBaseUrl: 'http://server2/zm/api' }]]), asProfileId('p1'));
    vi.mocked(getMonitor).mockResolvedValueOnce({
      Monitor: { ...mockMonitor, ServerId: '2' },
      Monitor_Status: mockMonitorStatus,
    } as never);

    const r = await getToolByName('get_monitor')!.execute({ monitorId: '1' }, ctx());

    expect(r.isError).toBeFalsy();
    expect(vi.mocked(getAlarmStatus)).toHaveBeenCalledWith(expect.anything(), '1', 'http://server2/zm/api');
  });

  it('get_monitor merges monitor detail with alarm status', async () => {
    const tool = getToolByName('get_monitor')!;
    const r = await tool.execute({ monitorId: '1' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Front Door');
    expect(r.output).toContain('alarm');
  });

  it('get_monitor includes control capability alongside alarm status', async () => {
    const tool = getToolByName('get_monitor')!;
    const r = await tool.execute({ monitorId: '1' }, ctx());
    expect(r.isError).toBeFalsy();
    const detail = JSON.parse(r.output as string);
    expect(detail).toMatchObject({
      controllable: true, controlId: '3', status: 'Connected',
      alarm: { status: 0, output: 0 },
    });
  });

  it('count_events maps monitor ids to names', async () => {
    const tool = getToolByName('count_events')!;
    const r = await tool.execute({ lastCount: 1, lastUnit: 'hour' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Front Door');
    expect(r.output).toContain('3');
  });

  it('count_events reports the summed total across monitors', async () => {
    const tool = getToolByName('count_events')!;
    const r = await tool.execute({ lastCount: 1, lastUnit: 'hour' }, ctx());
    expect(r.isError).toBeFalsy();
    const result = JSON.parse(r.output as string);
    expect(result).toMatchObject({
      interval: '1 hour', total: 3, monitors: [{ monitor: 'Front Door', count: 3 }],
    });
  });

  it('count_events refuses a calendar-only timeframe, naming the phrase', async () => {
    const tool = getToolByName('count_events')!;
    const r = await tool.execute(
      { lastCount: 1, lastUnit: 'day' },
      { ...ctx(), resolvedTimeframes: [{ phrase: 'today', fields: { daysAgo: 0 } }] },
    );
    expect(r.isError).toBe(true);
    expect(r.output).toContain('calendar-based ("today")');
    expect(r.output).toContain('list_events with when "today"');
  });

  it('count_events runs when a rolling timeframe is present', async () => {
    const tool = getToolByName('count_events')!;
    const r = await tool.execute(
      { lastCount: 1, lastUnit: 'hour' },
      { ...ctx(), resolvedTimeframes: [{ phrase: 'last hour', fields: { lastCount: 1, lastUnit: 'hour' } }] },
    );
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Front Door');
  });

  it('count_events runs when no resolvedTimeframes are supplied', async () => {
    const tool = getToolByName('count_events')!;
    const r = await tool.execute({ lastCount: 1, lastUnit: 'hour' }, ctx());
    expect(r.isError).toBeFalsy();
  });

  it('get_event returns duration/frames/score/notes', async () => {
    const tool = getToolByName('get_event')!;
    const r = await tool.execute({ eventId: '42' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('12.5');
    expect(r.output).toContain('detected:person');
  });

  it('get_event includes the monitor NAME and detected objects', async () => {
    const tool = getToolByName('get_event')!;
    const r = await tool.execute({ eventId: '42' }, ctx());
    expect(r.isError).toBeFalsy();
    const detail = JSON.parse(r.output as string);
    expect(detail).toMatchObject({ monitor: 'Front Door', objects: ['person', 'car'] });
  });

  it('get_event includes durationSec, totScore, tags, archived, and hasVideo', async () => {
    const tool = getToolByName('get_event')!;
    const r = await tool.execute({ eventId: '42' }, ctx());
    expect(r.isError).toBeFalsy();
    const detail = JSON.parse(r.output as string);
    expect(detail).toMatchObject({
      monitorId: '1', durationSec: 12.5, alarmFrames: 5, totScore: 120, archived: false,
      hasVideo: true, tags: [],
    });
  });

  it('get_event builds an event display card with imageUrls (refs #246)', async () => {
    const tool = getToolByName('get_event')!;
    const r = await tool.execute({ eventId: '42' }, ctxWithDisplay());
    expect(r.isError).toBeFalsy();
    expect(r.display).toHaveLength(1);
    expect(r.display![0]).toMatchObject({ kind: 'event', id: '42', navigatePath: '/events/42' });
    expect(r.display![0].imageUrls!.length).toBeGreaterThan(0);
    // The model-facing output string must never carry image URLs (vision non-goal).
    expect(r.output).not.toContain('http');
  });

  it('get_server_health aggregates load/disk/daemon/version', async () => {
    const tool = getToolByName('get_server_health')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('1.37.0');
    expect(r.output).toContain('42');
  });

  it('get_server_health includes per-storage usage and server count when both succeed', async () => {
    const tool = getToolByName('get_server_health')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const health = JSON.parse(r.output as string);
    expect(health).toMatchObject({
      storages: [{ name: 'Default', diskPercent: 50 }],
      serverCount: 1,
    });
  });

  it('get_server_health omits storages when getStorages rejects', async () => {
    vi.mocked(getStorages).mockRejectedValueOnce(new Error('storage.json not found'));
    const tool = getToolByName('get_server_health')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const health = JSON.parse(r.output as string);
    expect(health.storages).toBeUndefined();
    expect(health.daemonRunning).toBe(true);
  });

  it('get_server_health omits serverCount when getServers rejects', async () => {
    vi.mocked(getServers).mockRejectedValueOnce(new Error('servers.json not found'));
    const tool = getToolByName('get_server_health')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const health = JSON.parse(r.output as string);
    expect(health.serverCount).toBeUndefined();
    expect(health.storages).toMatchObject([{ name: 'Default', diskPercent: 50 }]);
  });

  it('list_groups returns id/name', async () => {
    const tool = getToolByName('list_groups')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('Outside');
  });

  it('list_groups includes member monitor ids when the group carries them', async () => {
    const tool = getToolByName('list_groups')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const groups = JSON.parse(r.output as string);
    expect(groups[0]).toMatchObject({ id: '1', name: 'Outside', monitorIds: ['1'] });
    expect(groups[1]).toMatchObject({ id: '2', name: 'Empty Group' });
    expect(groups[1].monitorIds).toBeUndefined();
  });

  it('list_tags degrades to an empty list when tags are unsupported', async () => {
    const tool = getToolByName('list_tags')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.output).toBe('[]');
  });

  it('an unknown tool name resolves to undefined', () => {
    expect(getToolByName('does_not_exist')).toBeUndefined();
  });

  // The assistant is read-only by construction: the tools that changed state
  // were deleted outright, so nothing here can reach a mutating API.
  it('TOOLS exposes exactly the read-only tools', () => {
    expect(TOOLS).toEqual([...readOnlyTools]);
  });

  it('does not resolve any withheld action by name, so the agent loop cannot run one', () => {
    for (const name of WITHHELD_TOOL_NAMES) {
      expect(getToolByName(name)).toBeUndefined();
      expect(isWithheldToolName(name)).toBe(true);
    }
  });

  it('does not report an unrelated unknown name as a withheld action', () => {
    expect(isWithheldToolName('list_monitors')).toBe(false);
    expect(isWithheldToolName('launch_missiles')).toBe(false);
  });

  it('list_events clamps a non-numeric or negative limit into [1, maxListEventsLimit]', async () => {
    const tool = getToolByName('list_events')!;
    const negative = await tool.execute({ limit: -5 }, ctx());
    expect(negative.isError).toBeFalsy();
    const nonNumeric = await tool.execute({ limit: 'banana' }, ctx());
    expect(nonNumeric.isError).toBeFalsy();
    // Both fall back to the max clamp rather than producing NaN/negative EventFilters.limit.
    expect(getEvents).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ limit: ASSISTANT.maxListEventsLimit }));
  });
});

describe('toolCallSignature', () => {
  // Ollama sent {"monitorId":"","when":"yesterday","objectType":""} and then
  // {"when":"yesterday"}: the same query, two different strings, so the repeat
  // guard did not fire and the identical query ran again.
  it('treats omitted-argument spellings as the same call', () => {
    const a = toolCallSignature('list_events', { monitorId: '', daysAgo: 1, objectType: '' });
    const b = toolCallSignature('list_events', { daysAgo: 1 });
    const c = toolCallSignature('list_events', { daysAgo: 1, objectType: null });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('ignores key order', () => {
    expect(toolCallSignature('list_events', { daysAgo: 0, limit: 5 })).toBe(
      toolCallSignature('list_events', { limit: 5, daysAgo: 0 }),
    );
  });

  it('still separates genuinely different calls', () => {
    expect(toolCallSignature('list_events', { daysAgo: 0 })).not.toBe(
      toolCallSignature('list_events', { daysAgo: 1 }),
    );
    expect(toolCallSignature('list_events', { daysAgo: 0 })).not.toBe(
      toolCallSignature('count_events', { daysAgo: 0 }),
    );
    expect(toolCallSignature('list_events', { daysAgo: 0, objectType: 'car' })).not.toBe(
      toolCallSignature('list_events', { daysAgo: 0 }),
    );
  });
});

describe('objectQuestionMismatch', () => {
  const labels = ['car', 'person', 'truck'];

  // The reported failure: "how many vehicles came today vs yesterday" called
  // count_events, which counts events of every kind, and the model reported
  // all 14 as vehicles.
  it('refuses count_events for a question naming a category', () => {
    const message = objectQuestionMismatch('count_events', 'how many vehicles came today vs yesterday', labels);
    expect(message).toContain('cannot answer this question');
    expect(message).toContain('list_events');
    expect(message).toContain('objectType');
  });

  it('refuses count_events for a question naming one of this install\'s labels', () => {
    expect(objectQuestionMismatch('count_events', 'how many trucks yesterday', labels)).toBeTruthy();
    // Plural or singular, either way.
    expect(objectQuestionMismatch('count_events', 'was there a truck today', labels)).toBeTruthy();
  });

  it('allows count_events for a question about events in general', () => {
    expect(objectQuestionMismatch('count_events', 'how many events in the last 24 hours', labels)).toBeUndefined();
    expect(objectQuestionMismatch('count_events', 'which monitor was most active', labels)).toBeUndefined();
  });

  // A word must not match inside another: "carrot" is a label on this user's
  // install, and "car" must not fire on it, nor the reverse.
  it('matches whole words only', () => {
    expect(objectQuestionMismatch('count_events', 'how many carrots today', ['car'])).toBeUndefined();
  });

  it('leaves every other tool alone', () => {
    expect(objectQuestionMismatch('list_events', 'how many vehicles today', labels)).toBeUndefined();
  });
});

describe('calendarTimeframeMismatch', () => {
  it('refuses when every resolved timeframe is calendar-based, naming the first phrase', () => {
    const message = calendarTimeframeMismatch([
      { phrase: 'today', fields: { daysAgo: 0 } },
      { phrase: 'yesterday', fields: { daysAgo: 1 } },
    ]);
    expect(message).toContain('calendar-based ("today")');
    expect(message).toContain('list_events with when "today"');
  });

  it('allows the call when any resolved timeframe is a rolling window', () => {
    expect(
      calendarTimeframeMismatch([
        { phrase: 'today', fields: { daysAgo: 0 } },
        { phrase: 'last hour', fields: { lastCount: 1, lastUnit: 'hour' } },
      ]),
    ).toBeUndefined();
  });

  it('stays off when no timeframes were resolved', () => {
    expect(calendarTimeframeMismatch(undefined)).toBeUndefined();
    expect(calendarTimeframeMismatch([])).toBeUndefined();
  });
});

describe('whenNotFromQuestion', () => {
  it('passes a phrase copied out of the question', () => {
    expect(whenNotFromQuestion('today', 'summarize today')).toBeUndefined();
    expect(whenNotFromQuestion('sunday from 4pm to 10pm', 'what happened sunday from 4pm to 10pm')).toBeUndefined();
  });

  it('ignores case and surrounding whitespace', () => {
    expect(whenNotFromQuestion('  Last   Week ', 'events from last week please')).toBeUndefined();
  });

  // Digits were dropped from the tokens and number words were not, so the two
  // spellings of the same phrase disagreed and the spelled-out form was
  // rejected, killing the turn (refs #310).
  it('treats a spelled-out number as the digit the question used', () => {
    expect(whenNotFromQuestion('two days ago', 'what was the busiest hour 2 days ago?')).toBeUndefined();
    expect(whenNotFromQuestion('2 days ago', 'what was the busiest hour two days ago?')).toBeUndefined();
    expect(whenNotFromQuestion('last three weeks', 'summarize the last 3 weeks')).toBeUndefined();
  });

  // The substring test carries no language assumptions, which is the whole
  // reason a verbatim copy is the contract.
  it('passes a copied phrase in any language', () => {
    expect(whenNotFromQuestion('letzte Woche', 'was ist letzte Woche passiert')).toBeUndefined();
    expect(whenNotFromQuestion('昨天', '昨天有什么事件')).toBeUndefined();
  });

  it('passes when no question is available', () => {
    expect(whenNotFromQuestion('yesterday', undefined)).toBeUndefined();
  });

  // The reported failure: earlier turns about yesterday taught the model the
  // word, and "summarize today" was answered with yesterday's events.
  it('rejects a phrase the question never used, quoting the question', () => {
    const message = whenNotFromQuestion('yesterday', 'summarize today');
    expect(message).toContain('"yesterday"');
    expect(message).toContain('summarize today');
    expect(message).toContain('omit when');
  });

  // The default-today case: the timeframe stage resolved "today" though the
  // user never typed it, so an allowed phrase passes even when the question
  // does not contain it (refs #270).
  it('passes a phrase absent from the question but present in allowedPhrases', () => {
    expect(whenNotFromQuestion('today', 'give me a summary', ['today'])).toBeUndefined();
  });

  it('matches an allowed phrase ignoring case and whitespace', () => {
    expect(whenNotFromQuestion('  TODAY ', 'a summary please', ['today'])).toBeUndefined();
  });

  it('still rejects a phrase in neither the question nor allowedPhrases', () => {
    const message = whenNotFromQuestion('yesterday', 'summarize today', ['today']);
    expect(message).toContain('"yesterday"');
  });

  // The live failure (refs #270): a rephrased time range with the same instants
  // must pass even though "10:00:00 AM" is not the substring "10am". Both days
  // named in the question are legal.
  it('accepts a rephrased time-range when whose canonical times match the question', () => {
    const question = 'Compare 10am-6pm yesterday and today.';
    expect(whenNotFromQuestion('yesterday 10:00:00 AM to 18:00:00 PM', question)).toBeUndefined();
    expect(whenNotFromQuestion('today 10:00:00 AM to 18:00:00 PM', question)).toBeUndefined();
  });

  // Words present but a time the question never named: still the wrong window.
  it('rejects a time-range when whose times are absent from the question', () => {
    const message = whenNotFromQuestion('yesterday 3pm to 5pm', 'Compare 10am-6pm yesterday and today.');
    expect(message).toContain('"yesterday 3pm to 5pm"');
  });
});

describe('stripOmittedArgs', () => {
  // The crash this prevents: llama3.2 filled every unused argument with null,
  // `eventIds: null` reached the api layer whose guard reads `!== undefined`,
  // and `null.length` threw "Cannot read properties of null". Each tool was
  // normalizing its own arguments by hand, so any argument someone forgot
  // became the next crash.
  it('drops the null-filled arguments a model sends for "unused"', () => {
    expect(
      stripOmittedArgs({ eventIds: null, limit: 25, daysAgo: 0, monitorId: null, objectType: null, tag: null }),
    ).toEqual({ limit: 25, daysAgo: 0 });
  });

  it('drops placeholder strings and empty arrays too', () => {
    expect(stripOmittedArgs({ daysAgo: 0, objectType: '{}', tag: '', eventIds: [] })).toEqual({ daysAgo: 0 });
  });

  it('keeps every real value, including falsy ones that mean something', () => {
    expect(stripOmittedArgs({ daysAgo: 0, objectType: ['car'], limit: 0 })).toEqual({
      daysAgo: 0,
      objectType: ['car'],
      limit: 0,
    });
  });
});

describe('repairCountEventsInterval', () => {
  // Weak models (Apple Foundation Models, qwen) call count_events with the
  // tool's OWN internal MySQL-interval shape `{"interval":"1 day"}` instead of
  // the schema's lastCount+lastUnit. additionalProperties:false rejects it and
  // they never recover, so split it into the two real fields before validation.
  it('splits an interval string into lastCount + lastUnit and drops interval', () => {
    expect(repairCountEventsInterval({ interval: '1 day' })).toEqual({ lastCount: 1, lastUnit: 'day' });
  });

  it('handles multi-digit counts', () => {
    expect(repairCountEventsInterval({ interval: '24 hour' })).toEqual({ lastCount: 24, lastUnit: 'hour' });
  });

  it('normalizes a plural unit to singular', () => {
    expect(repairCountEventsInterval({ interval: '7 days' })).toEqual({ lastCount: 7, lastUnit: 'day' });
  });

  it('leaves a correct call untouched when lastCount is already present', () => {
    expect(repairCountEventsInterval({ lastCount: 1, lastUnit: 'day' })).toEqual({ lastCount: 1, lastUnit: 'day' });
  });

  it('passes a non-matching string through unchanged', () => {
    expect(repairCountEventsInterval({ interval: 'yesterday' })).toEqual({ interval: 'yesterday' });
  });
});

describe('coerceLabelList', () => {
  // Ollama serializes tool `arguments` as a JSON STRING, and llama3.2
  // stringified the array inside it. Read as one label, `['car', 'truck']` was
  // rejected as unknown and the turn looped on the rejection. The same model
  // on the on-device path sends a real array: the malformation belongs to the
  // wire format, not to the model.
  it('reads a list the model stringified, in JSON or Python quoting', () => {
    expect(coerceLabelList("['car', 'truck']")).toEqual(['car', 'truck']);
    expect(coerceLabelList('["car","truck"]')).toEqual(['car', 'truck']);
    expect(coerceLabelList('[car, truck]')).toEqual(['car', 'truck']);
  });

  it('passes a real array and a single label through', () => {
    expect(coerceLabelList(['car', 'truck'])).toEqual(['car', 'truck']);
    expect(coerceLabelList('car')).toEqual(['car']);
    expect(coerceLabelList('')).toEqual([]);
  });

  // The Python-quote repair must not run on valid JSON: a global '->" swap
  // corrupted any label that legitimately contains an apostrophe.
  it('keeps an apostrophe inside a valid JSON label', () => {
    expect(coerceLabelList('["driver\'s seat", "car"]')).toEqual(["driver's seat", 'car']);
  });
});

describe('isOmittedArg', () => {
  // "{}" is what llama3.2 puts in an argument it means to leave out. Treated
  // as a real label it was rejected as an unknown object type, and the turn
  // looped on the rejection.
  it('treats empty JSON literals as omitted', () => {
    expect(isOmittedArg('{}')).toBe(true);
    expect(isOmittedArg('[]')).toBe(true);
  });

  it('still treats a real label as present', () => {
    expect(isOmittedArg('car')).toBe(false);
  });
});

describe('objectTypePattern', () => {
  it('passes one label through', () => {
    expect(objectTypePattern('car')).toBe('car');
  });

  // "vehicles" arrives as the labels the MODEL picked from this install's own
  // vocabulary (see object-labels.ts), not from a hardcoded category map.
  it('joins several labels into an alternation', () => {
    expect(objectTypePattern(['car', 'truck'])).toBe('(car|truck)');
  });

  // The result is spliced into a `Notes REGEXP` the server runs.
  it('strips regex metacharacters', () => {
    expect(objectTypePattern('.*')).toBe('');
    expect(objectTypePattern('ca(r|t)')).toBe('cart');
    expect(objectTypePattern(['car', ''])).toBe('car');
  });

  // A detector may write labels in any script. ASCII-only normalization turned
  // them into '', which silently dropped the object filter.
  it('keeps non-Latin labels', () => {
    expect(objectTypePattern('собака')).toBe('собака');
    expect(objectTypePattern(['人', 'car'])).toBe('(人|car)');
  });
});

describe('matchLabels', () => {
  // A category word maps onto whatever members this install records, and only
  // those: "vehicles" against [car, person, truck] is car+truck, never bus.
  it('expands a category word to the members intersected with the real labels', () => {
    expect(matchLabels(['vehicles'], ['car', 'person', 'truck'])).toEqual({
      matched: ['car', 'truck'],
      unmatched: [],
    });
  });

  it('maps every person-word onto person', () => {
    expect(matchLabels(['people'], ['car', 'person', 'truck'])).toEqual({ matched: ['person'], unmatched: [] });
    expect(matchLabels(['anyone'], ['person']).matched).toEqual(['person']);
  });

  it('maps an animal category onto the animals recorded', () => {
    expect(matchLabels(['animals'], ['dog', 'cat', 'car']).matched).toEqual(['dog', 'cat']);
  });

  it('passes an exact label straight through', () => {
    expect(matchLabels(['car'], ['car', 'person'])).toEqual({ matched: ['car'], unmatched: [] });
  });

  it('tolerates singular and plural', () => {
    expect(matchLabels(['cars'], ['car']).matched).toEqual(['car']);
    expect(matchLabels(['buses'], ['bus']).matched).toEqual(['bus']);
  });

  it('leaves a word nothing matches unmatched', () => {
    expect(matchLabels(['unicorn'], ['car', 'person'])).toEqual({ matched: [], unmatched: ['unicorn'] });
  });

  it('matches nothing against an empty vocabulary', () => {
    expect(matchLabels(['car', 'vehicles'], [])).toEqual({ matched: [], unmatched: ['car', 'vehicles'] });
  });
});

describe('validateToolInput (the refine step, refs #246)', () => {
  // Both of these are arguments llama3.2 actually produced. Each is decidable
  // from the schema alone, so neither should reach a request.
  // A synthetic schema: list_events no longer has an enum field (`when` takes
  // a phrase instead), but the check still guards any tool that adds one.
  it('rejects a value outside an enum, naming the values that would work', () => {
    const schema = { type: 'object', properties: { mode: { type: 'string', enum: ['fast', 'slow'] } } };
    const error = validateToolInput(schema, { mode: 'somewhat brisk' });
    expect(error).toContain('mode must be one of: fast, slow');
  });

  // A stale argument from an older contract (`range`, `when`) is reported as
  // unknown, with the structured window fields named as the valid ones.
  it('steers a stale time argument to the fields that replaced it', () => {
    const tool = getToolByName('list_events')!;
    const error = validateToolInput(tool.schema, { range: 'yesterday from 16:00 to 22:00' });
    expect(error).toContain('range is not an argument of this tool');
    expect(error).toContain('when');
  });

  it('rejects an argument the tool does not have', () => {
    const tool = getToolByName('list_events')!;
    expect(validateToolInput(tool.schema, { rnge: 'today' })).toContain('is not an argument of this tool');
  });

  it('reports a missing required argument', () => {
    const tool = getToolByName('get_monitor')!;
    expect(validateToolInput(tool.schema, {})).toContain('monitorId is required');
  });

  // The placeholder strings small models send for "no value" must not be
  // type-checked as real values (see isOmittedArg), or every optional argument
  // becomes an error.
  it('lets a placeholder stand for an omitted optional argument', () => {
    const tool = getToolByName('list_events')!;
    expect(validateToolInput(tool.schema, { when: 'today', objectType: 'null', monitorId: 'none' })).toBeUndefined();
  });

  it('accepts a well-formed call', () => {
    const tool = getToolByName('list_events')!;
    expect(validateToolInput(tool.schema, { when: 'yesterday from 4pm to 10pm' })).toBeUndefined();
  });

  // objectType takes a label OR a list of them, and the prompt asks for a list
  // whenever the user names a category. A schema declaring only "string" made
  // this validator reject the exact call the prompt had just requested.
  it('accepts either shape of a multi-type argument', () => {
    const tool = getToolByName('list_events')!;
    expect(validateToolInput(tool.schema, { objectType: 'car' })).toBeUndefined();
    expect(validateToolInput(tool.schema, { objectType: ['car', 'truck'] })).toBeUndefined();
    expect(validateToolInput(tool.schema, { objectType: { a: 1 } })).toContain('must be string or array');
  });

  it('still holds a single-type argument to its type', () => {
    const tool = getToolByName('list_events')!;
    expect(validateToolInput(tool.schema, { eventIds: 'not-an-array' })).toContain('must be array');
  });

  // `Number(['5'])` is 5, so a single-element array used to slip through the
  // number check as if it were numeric.
  it('rejects a non-numeric value for a number argument', () => {
    const tool = getToolByName('list_events')!;
    expect(validateToolInput(tool.schema, { limit: ['5'] })).toContain('limit must be a number');
    expect(validateToolInput(tool.schema, { limit: '10' })).toBeUndefined();
  });
});

describe('list_events when resolution (refs #246)', () => {
  // Fixes the clock so `resolveWhen`'s `new Date()` call inside the executor
  // is deterministic; matches event-range.test.ts's own NOW so the expected
  // wall-clock strings line up with that file's documented math.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T14:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves `when` against ctx.timezone into startDateTime/endDateTime filters', async () => {
    const tool = getToolByName('list_events')!;
    await tool.execute({ when: 'today' }, { ...ctx(), timezone: 'America/New_York' });
    expect(getEvents).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ startDateTime: '2026-07-16 00:00:00', endDateTime: '2026-07-16 10:30:00' }),
    );
  });

  // Observed live: "what were the busiest hours?" reached list_events as
  // when:"the busiest hours", the interpreter returned fields naming no
  // window, and the query ran with NO time filter over every event ever
  // recorded - then reported a "busiest hour" from the newest 25 rows. A
  // phrase that resolves to nothing must correct the model, not silently
  // widen the question.
  it('refuses a `when` phrase that resolves to no window at all', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute(
      { when: 'the busiest hours' },
      { ...ctx(), interpretWhen: vi.fn(async () => ({})), timezone: 'America/New_York' },
    );

    expect(r.isError).toBe(true);
    expect(r.output).toContain('the busiest hours');
    expect(getEvents).not.toHaveBeenCalled();
  });

  it('falls back to the browser timezone when ctx.timezone is unset', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ when: 'last hour' }, ctx());
    expect(r.isError).toBeFalsy();
    expect(getEvents).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ startDateTime: expect.any(String), endDateTime: expect.any(String) }),
    );
  });

  // The whole point of `when`: the model copies the user's words and the app
  // does the arithmetic. Previously the model had to produce the dates, and
  // produced the 19th and the 20th for a question about the 15th.
  it('resolves a `when` phrase into exact timestamps', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute(
      { when: 'yesterday from 4pm to 10pm', objectType: 'person' },
      { ...ctx(), timezone: 'America/New_York' },
    );
    expect(r.isError).toBeFalsy();
    expect(getEvents).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({
        startDateTime: '2026-07-15 16:00:00',
        endDateTime: '2026-07-15 22:00:00',
        notesRegexp: 'detected:.*person',
      }),
    );
  });

  // The model echoes whatever time format the rows carry, so rendering rows
  // and window through the profile's own format makes answers match the rest
  // of the app (rule 21, refs #262). No format in the context leaves ZM's raw
  // timestamps untouched (covered by every other test in this file).
  it('renders row and window times in the profile date/time format when given one', async () => {
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-07-15 16:05:00', Length: '30', Notes: 'detected:person' } },
      ],
      pagination: { page: 1, pageCount: 1, current: 1, count: 1, prevPage: false, nextPage: false, limit: 25, totalCount: 1 },
    } as never);

    const tool = getToolByName('list_events')!;
    const r = await tool.execute(
      { when: 'yesterday' },
      {
        ...ctx(),
        timezone: 'America/New_York',
        dateTimeFormat: { dateFormat: 'MMM d, yyyy', timeFormat: '12h', customDateFormat: '', customTimeFormat: '' },
      },
    );

    const parsed = JSON.parse(r.output);
    expect(parsed.events[0].start).toBe('Jul 15, 2026, 4:05:00 PM');
    expect(parsed.window.from).toBe('Jul 15, 2026, 12:00:00 AM');
    // The QUERY still uses raw ZM timestamps; only the presentation formats.
    expect(getEvents).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ startDateTime: '2026-07-15 00:00:00' }));
  });

  // "Busiest hour" is timestamp arithmetic, so the tool computes the tally
  // and hands the winner over as data. It rides OUTSIDE the summary so a
  // summarize answer quoting the summary never contains an hour label, which
  // would falsely narrow the result cards (refs #264).
  it('reports the busiest hour and per-hour counts from the shown rows', async () => {
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-07-15 08:10:00', Length: '30', Notes: 'detected:person' } },
        { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-07-15 08:40:00', Length: '30', Notes: 'detected:person' } },
        { Event: { Id: '3', MonitorId: '2', StartDateTime: '2026-07-15 11:20:00', Length: '30', Notes: 'detected:car' } },
      ],
      pagination: { page: 1, pageCount: 1, current: 1, count: 3, prevPage: false, nextPage: false, limit: 25, totalCount: 3 },
    } as never);

    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ when: 'yesterday' }, { ...ctx(), timezone: 'America/New_York' });

    const parsed = JSON.parse(r.output);
    expect(parsed.summary).not.toContain('Busiest hour');
    expect(parsed.busiestHour).toEqual({ label: '2026-07-15 08:00:00', count: 2 });
    expect(parsed.countsByHour).toEqual({ '2026-07-15 08:00:00': 2, '2026-07-15 11:00:00': 1 });
  });

  /**
   * Observed live: a 9am-2pm window matched 4831 events on one server, 25 were
   * listed, and the answer reported "HoopVivotek 11, HoopHouse 11" as the
   * window's breakdown. The tool said "(listed rows)"; the model dropped the
   * qualifier, as models do with hedges. A page tally is not a breakdown, so
   * when the server has more pages the per-monitor counts are queried for
   * real - one count per monitor over the same window - and detections, which
   * cannot be totalled that way, are left out entirely.
   */
  describe('per-monitor totals when the result is one page of many', () => {
    const TWO_MONITORS = {
      monitors: [
        { Monitor: { ...mockMonitor, Id: '1', Name: 'Front Door' } },
        { Monitor: { ...mockMonitor, Id: '2', Name: 'Backyard' } },
      ],
    };
    const page = {
      events: [
        { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-07-15 09:10:00', Length: '30', Notes: 'detected:person' } },
        { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-07-15 09:40:00', Length: '30', Notes: 'detected:person' } },
      ],
      pagination: { page: 1, pageCount: 40, current: 1, count: 2, prevPage: false, nextPage: true, limit: 25, totalCount: 987 },
    };
    const countOnly = (total: number) => ({
      events: [],
      pagination: { page: 1, pageCount: 1, current: 1, count: 0, prevPage: false, nextPage: false, limit: 1, totalCount: total },
    });

    it('reports the real per-monitor counts for the window, not the page', async () => {
      vi.mocked(getMonitors).mockResolvedValueOnce(TWO_MONITORS as never);
      vi.mocked(getEvents)
        .mockResolvedValueOnce(page as never)
        .mockResolvedValueOnce(countOnly(300) as never)
        .mockResolvedValueOnce(countOnly(687) as never);

      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ when: 'yesterday' }, { ...ctx(), timezone: 'America/New_York' });

      const parsed = JSON.parse(r.output);
      expect(parsed.countsByMonitor).toEqual({ 'Front Door': 300, Backyard: 687 });
      // The page held two Front Door rows and no Backyard row at all: a tally
      // of what was listed would have said so.
      expect(parsed.summary).toContain('Front Door 300');
      expect(parsed.summary).not.toContain('(listed rows)');
    });

    it('leaves detections out, since a page cannot total them', async () => {
      vi.mocked(getMonitors).mockResolvedValueOnce(TWO_MONITORS as never);
      vi.mocked(getEvents)
        .mockResolvedValueOnce(page as never)
        .mockResolvedValueOnce(countOnly(300) as never)
        .mockResolvedValueOnce(countOnly(687) as never);

      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ when: 'yesterday' }, { ...ctx(), timezone: 'America/New_York' });

      const parsed = JSON.parse(r.output);
      expect(parsed.objectCounts).toBeUndefined();
      expect(parsed.summary).not.toContain('Detected');
    });

    it('falls back to the listed rows, and says so, when a count query fails', async () => {
      vi.mocked(getMonitors).mockResolvedValueOnce(TWO_MONITORS as never);
      vi.mocked(getEvents)
        .mockResolvedValueOnce(page as never)
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(countOnly(687) as never);

      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ when: 'yesterday' }, { ...ctx(), timezone: 'America/New_York' });

      const parsed = JSON.parse(r.output);
      expect(r.isError).toBeFalsy();
      expect(parsed.countsByMonitor).toEqual({ 'Front Door': 2 });
      expect(parsed.summary).toContain('(listed rows)');
    });

    // Nothing beyond this page means the rows ARE the matches, so the counts
    // are the window's already and no extra request is worth making.
    it('asks for no totals when the page holds every match', async () => {
      vi.mocked(getMonitors).mockResolvedValueOnce(TWO_MONITORS as never);
      vi.mocked(getEvents).mockResolvedValueOnce({
        ...page,
        pagination: { ...page.pagination, pageCount: 1, nextPage: false, totalCount: 2 },
      } as never);

      const tool = getToolByName('list_events')!;
      const r = await tool.execute({ when: 'yesterday' }, { ...ctx(), timezone: 'America/New_York' });

      expect(vi.mocked(getEvents)).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(r.output);
      expect(parsed.countsByMonitor).toEqual({ 'Front Door': 2 });
      expect(parsed.objectCounts).toEqual({ person: 2 });
    });
  });

  // Same incident as the no-window case above: with 515 matches and 25 rows
  // shown, the "busiest hour" was the busiest hour OF THE NEWEST 25 EVENTS,
  // presented as fact. A ranking off a truncated page is not one, so the
  // fields go away and the model has nothing to quote.
  it('omits the hour ranking when the rows are only a page of the matches', async () => {
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-07-15 08:10:00', Length: '30', Notes: 'detected:person' } },
        { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-07-15 08:40:00', Length: '30', Notes: 'detected:person' } },
      ],
      pagination: { page: 1, pageCount: 9, current: 1, count: 2, prevPage: false, nextPage: true, limit: 25, totalCount: 515 },
    } as never);

    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ when: 'yesterday' }, { ...ctx(), timezone: 'America/New_York' });

    const parsed = JSON.parse(r.output);
    expect(parsed.moreMatchesExist).toBe(true);
    expect(parsed.busiestHour).toBeUndefined();
    expect(parsed.countsByHour).toBeUndefined();
  });

  // The model reported ten rows as "8 Front Yard, 2 Garage Outdoor" when the
  // real split was four and six. It should be reading a tally, not counting.
  it('supplies the per-monitor tally so the model never counts rows', async () => {
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        { Event: { Id: '1', MonitorId: '1', StartDateTime: '2026-07-15 10:00:00', Length: '30', Notes: 'detected:car' } },
        { Event: { Id: '2', MonitorId: '1', StartDateTime: '2026-07-15 11:00:00', Length: '30', Notes: 'detected:car' } },
        { Event: { Id: '3', MonitorId: '2', StartDateTime: '2026-07-15 12:00:00', Length: '30', Notes: 'detected:truck' } },
      ],
      pagination: { page: 1, pageCount: 1, current: 1, count: 3, prevPage: false, nextPage: false, limit: 25, totalCount: 3 },
    } as never);

    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ when: 'yesterday' }, { ...ctx(), timezone: 'America/New_York', question: 'what happened yesterday' });

    const parsed = JSON.parse(r.output);
    expect(parsed.matchCount).toBe(3);
    // Keyed by whatever the row shows as its monitor: the resolved NAME, or
    // the raw id when the monitor list has no name for it.
    expect(parsed.countsByMonitor).toEqual({ 'Front Door': 2, '2': 1 });
  });

  // The whole point of giving the model the vocabulary: a label the detector
  // never writes cannot answer anything, and a zero-row "none" for it is
  // wrong when the real label was sitting right there.
  it('refuses an objectType this install does not record, naming the ones it does', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute(
      { when: 'yesterday', objectType: 'unicorn' },
      { ...ctx(), timezone: 'America/New_York', question: 'did a unicorn appear yesterday', objectLabels: ['car', 'person', 'truck'] },
    );

    expect(r.isError).toBe(true);
    expect(r.output).toContain('"unicorn" is not a label this installation records');
    expect(r.output).toContain('car, person, truck');
    expect(getEvents).not.toHaveBeenCalled();
  });

  // The user's word "vehicles" is not a label any detector writes; matchLabels
  // maps it onto the car and truck rows this install actually records.
  it('expands a category word onto the real labels it records', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute(
      { when: 'yesterday', objectType: 'vehicles' },
      { ...ctx(), timezone: 'America/New_York', question: 'how many vehicles came yesterday', objectLabels: ['car', 'person', 'truck'] },
    );

    expect(r.isError).toBeFalsy();
    expect(getEvents).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ notesRegexp: 'detected:.*(car|truck)' }));
  });

  it('accepts a list the model stringified rather than rejecting it as one label', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute(
      // Question names "vehicles" so the parsed objectType survives the
      // ungrounded-objectType strip and the stringified-list parse is what is
      // under test here.
      { when: 'today', objectType: "['car', 'truck']" },
      { ...ctx(), timezone: 'America/New_York', question: 'summarize vehicles today', objectLabels: ['car', 'person', 'truck'] },
    );

    expect(r.isError).toBeFalsy();
    expect(getEvents).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ notesRegexp: 'detected:.*(car|truck)' }));
  });

  it('treats an empty JSON literal as no filter at all', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute(
      { when: 'today', objectType: '{}' },
      { ...ctx(), timezone: 'America/New_York', question: 'summarize today', objectLabels: ['car', 'person'] },
    );

    expect(r.isError).toBeFalsy();
    expect(getEvents).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ notesRegexp: undefined }));
  });

  it('accepts labels that are in the vocabulary', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute(
      { when: 'yesterday', objectType: ['car', 'truck'] },
      { ...ctx(), timezone: 'America/New_York', question: 'how many vehicles came yesterday', objectLabels: ['car', 'person', 'truck'] },
    );

    expect(r.isError).toBeFalsy();
    expect(getEvents).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ notesRegexp: 'detected:.*(car|truck)' }));
  });

  // Refs #432, observed live: "how may folks came to the front of my house" -
  // the model's objectType ["person"] was right ("folks" means person), but
  // "folks" is outside the English word list, so objectTypeUngrounded
  // stripped the filter and 46 unfiltered events came back. A label the
  // parse stage grounded from the question's own words skips that guard.
  it('keeps an objectType the parse stage grounded, though the English scan cannot see it', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute(
      { when: 'today', objectType: 'person' },
      {
        ...ctx(),
        timezone: 'America/New_York',
        question: 'how many folks came by today',
        objectLabels: ['car', 'person'],
        plannedObjectTypes: ['person'],
      },
    );

    expect(r.isError).toBeFalsy();
    expect(getEvents).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ notesRegexp: 'detected:.*person' }));
  });

  it('hands back an uninterpretable when phrase instead of querying a guessed window', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ when: 'sometime last spring' }, { ...ctx(), timezone: 'America/New_York' });
    expect(r.isError).toBe(true);
    expect(r.output).toContain('Could not interpret');
    expect(getEvents).not.toHaveBeenCalled();
  });

  // An objectType that normalizes to nothing must error, not silently query
  // unfiltered: every event would be presented as the "filtered" result.
  it('refuses an objectType that normalizes to an empty pattern', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({ when: 'today', objectType: '@#$' }, { ...ctx(), timezone: 'America/New_York' });
    expect(r.isError).toBe(true);
    expect(r.output).toContain('not a usable label');
    expect(getEvents).not.toHaveBeenCalled();
  });

  it('combines when with objectType into a notesRegexp filter, for "how many people today" style questions', async () => {
    const tool = getToolByName('list_events')!;
    await tool.execute({ when: 'today', objectType: 'person' }, { ...ctx(), timezone: 'America/New_York' });
    expect(getEvents).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ startDateTime: '2026-07-16 00:00:00', notesRegexp: 'detected:.*person' }),
    );
  });

  // A zero-row objectType query used to be indistinguishable from "nothing
  // happened", and the model said so: asked "how many people came to my house
  // today" it sent objectType "people" against events labelled "person" and
  // told the user nobody had come. The label vocabulary is install-specific,
  // so the tool reports the labels actually present instead (refs #246).
  describe('list_events objectType vocabulary', () => {
    // These tests care about the difference between the FILTERED query and the
    // label PROBE that follows it, so they set behaviour per call. Chained
    // `mockResolvedValueOnce` made that order-dependent across the file: a
    // queued value left by an earlier test shifted which response the probe
    // saw, and the failure looked like a bug in the tool. Each test below
    // states both responses explicitly, and this restores the file-wide
    // default afterwards so nothing leaks out of the block.
    const defaultPage = {
      events: [
        {
          Event: {
            Id: '42', MonitorId: '1', Cause: 'Motion', StartDateTime: '2026-01-01 00:00:00',
            EndDateTime: '2026-01-01 00:01:00', Length: '12.5', Frames: '30', AlarmFrames: '5',
            MaxScore: '10', AvgScore: '4', TotScore: '120', Archived: '0',
            Notes: 'detected:person,car|Motion: All',
          },
        },
      ],
      pagination: { page: 1, pageCount: 1, current: 1, count: 1, prevPage: false, nextPage: false, limit: 25, totalCount: 1 },
    };

    /** `filtered` answers the objectType query, `probe` the unfiltered re-run. */
    const respond = (filtered: unknown, probe: unknown) => {
      vi.mocked(getEvents).mockReset();
      vi.mocked(getEvents).mockImplementation(async (_client, _profileId, f) =>
        ((f as { notesRegexp?: string }).notesRegexp ? filtered : probe) as never,
      );
    };

    afterEach(() => {
      vi.mocked(getEvents).mockReset();
      vi.mocked(getEvents).mockResolvedValue(defaultPage as never);
    });

    const emptyPage = {
      events: [],
      pagination: { page: 1, pageCount: 1, current: 1, count: 0, prevPage: false, nextPage: false, limit: 25, totalCount: 0 },
    };

    // A category word now arrives as the labels the MODEL chose from this
    // install's vocabulary, so the query covers them in one shot.
    it('queries every label the model supplied for a category', async () => {
      respond(defaultPage, defaultPage);
      const tool = getToolByName('list_events')!;

      await tool.execute(
        { when: 'yesterday', objectType: ['car', 'truck'] },
        { ...ctx(), timezone: 'America/New_York' },
      );

      expect((vi.mocked(getEvents).mock.calls[0][2] as { notesRegexp?: string }).notesRegexp).toBe(
        'detected:.*(car|truck)',
      );
    });

    // The bug this replaced: asked "how many cars came in today" on a day with
    // only people, the tool said "retry with one of those exact labels", the
    // model retried with `person`, and answered "There were 6 people recorded
    // today" to a question about cars. "car" is a real label that simply did
    // not occur, so none IS the answer.
    it('answers none for a real label that did not occur, instead of steering to another object', async () => {
      // The filtered query finds nothing; the probe finds a day of people only,
      // which is exactly the situation that produced the wrong answer.
      const peopleOnly = {
        events: [
          { Event: { Id: '252633', MonitorId: '1', Name: 'e', StartTime: '2026-07-16 09:00:00', Length: '30', Notes: 'detected:person' } },
        ],
        pagination: { page: 1, pageCount: 1, current: 1, count: 1, prevPage: false, nextPage: false, limit: 25, totalCount: 1 },
      };
      // Reset first, then default the PROBE to a people-only day and override
      // just the first (filtered) call. Chained `mockResolvedValueOnce` alone
      // is order-dependent: a leftover queued value from an earlier test in
      // this describe silently shifts which response the probe sees.
      respond(emptyPage, peopleOnly);
      const tool = getToolByName('list_events')!;

      const r = await tool.execute({ when: 'today', objectType: 'car' }, { ...ctx(), timezone: 'America/New_York' });

      expect(r.isError).toBeFalsy();
      const parsed = JSON.parse(r.output);
      expect(parsed.events).toEqual([]);
      expect(parsed.matchCount).toBe(0);
      expect(parsed.note).toContain('No "car" was detected');
      expect(parsed.note).toContain('tell the user there were none');
      expect(parsed.note).toContain('otherwise the answer is none');
      // And the window must state the day that was queried, not "no filter".
      expect(parsed.window).toEqual({ from: '2026-07-16 00:00:00', to: '2026-07-16 10:30:00' });
    });

    it('returns a normal empty result when the window genuinely has no events', async () => {
      respond(emptyPage, emptyPage);
      const tool = getToolByName('list_events')!;

      const r = await tool.execute({ when: 'today', objectType: 'person' }, ctx());

      expect(r.isError).toBeFalsy();
      const parsed = JSON.parse(r.output);
      expect(parsed.events).toEqual([]);
      // The window is always reported, so the model cannot invent a period it
      // never queried.
      expect(parsed.window).toMatchObject({ from: expect.any(String), to: expect.any(String) });
    });

    // It answered "no people in the last 24 hours" having queried no range at
    // all. An unfiltered query now says so in words the model can repeat.
    it('says plainly when no time filter was applied', async () => {
      const tool = getToolByName('list_events')!;

      const r = await tool.execute({}, ctx());

      expect(JSON.parse(r.output).window).toBe('all recorded events, no time filter applied');
    });

    it('does not probe when the objectType query returned rows', async () => {
      const tool = getToolByName('list_events')!;

      const r = await tool.execute({ when: 'today', objectType: 'person' }, ctx());

      expect(r.isError).toBeFalsy();
      expect(getEvents).toHaveBeenCalledTimes(1);
    });
  });

  it('flags truncated when more matches exist beyond the capped page', async () => {
    vi.mocked(getEvents).mockResolvedValueOnce({
      events: [
        {
          Event: {
            Id: '42', MonitorId: '1', StorageId: null, SecondaryStorageId: null, Name: 'Event 42',
            Cause: 'Motion', StartDateTime: '2026-01-01 00:00:00', EndDateTime: '2026-01-01 00:01:00',
            Width: '1920', Height: '1080', Length: '12.5', Frames: '30', AlarmFrames: '5',
            DefaultVideo: null, SaveJPEGs: null, MaxScore: '10', AvgScore: '4', TotScore: '120',
            Archived: '0', Videoed: '0', Uploaded: '0', Emailed: '0', Messaged: '0', Executed: '0',
            Notes: 'detected:person,car|Motion: All', StateId: null, Orientation: null,
            DiskSpace: null, Scheme: null,
          },
        },
      ],
      pagination: { page: 1, pageCount: 2, current: 1, count: 1, prevPage: false, nextPage: true, limit: 1, totalCount: 2 },
    });
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctx());
    expect(r.isError).toBeFalsy();
    const parsed = JSON.parse(r.output as string);
    // Names the count it is showing, rather than a bare "truncated" that a
    // small model reads as "nothing found".
    expect(parsed.moreMatchesExist).toBe(true);
    expect(parsed.shownEvents).toBe(1);
    expect(parsed.events).toHaveLength(1);
    // matchCount is the server's TRUE total, not the page (refs #246):
    // comparisons must quote real counts, never the cap.
    expect(parsed.matchCount).toBe(2);
    expect(parsed.summary).toContain('2 events');
  });

  it('leaves the more-matches flag unset when every match fits on the page', async () => {
    const tool = getToolByName('list_events')!;
    const r = await tool.execute({}, ctx());
    const parsed = JSON.parse(r.output as string);
    expect(parsed.moreMatchesExist).toBeUndefined();
    expect(parsed.shownEvents).toBeUndefined();
  });
});

describe('tool output budget', () => {
  it('returns valid, explicitly truncated JSON for oversized output', async () => {
    const result = await safeExecute('large', async () => 'x'.repeat(ASSISTANT.maxToolResultCharacters + 1));
    expect(JSON.parse(result.output)).toMatchObject({ truncated: true });
  });
});
