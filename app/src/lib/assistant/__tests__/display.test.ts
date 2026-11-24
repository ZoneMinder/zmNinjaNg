/**
 * The SHOW directive (refs #264): the model ends its answer with
 * `SHOW: events=<ids> monitors=<ids>` to say which result cards its answer
 * is about; the app strips the line and renders only those cards. The ids
 * can only select among cards the turn's tools actually produced, so the
 * model cannot conjure a card, and a directive that selects nothing falls
 * back to every card rather than hiding the answer's evidence.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildEventDisplayEntity, extractShowDirective, filterDisplayByShow } from '../display';
import { asProfileId, type MonitorData } from '../../../api/types';
import { clearAllServerMaps, registerServerResolverGate, setServerMap } from '../../zm/server-resolver';
import type { DisplayEntity, ToolContext } from '../types';

const event = (id: string): DisplayEntity => ({ kind: 'event', id, title: id, navigatePath: `/events/${id}` });
const monitor = (id: string): DisplayEntity => ({ kind: 'monitor', id, title: id, navigatePath: `/monitors/${id}` });

describe('extractShowDirective', () => {
  it('splits a final SHOW line off the answer and parses both id lists', () => {
    const { text, show } = extractShowDirective('Busiest hour was 7 PM with 9 events.\nSHOW: events=101,102 monitors=3');
    expect(text).toBe('Busiest hour was 7 PM with 9 events.');
    expect(show).toEqual({ events: ['101', '102'], monitors: ['3'] });
  });

  it('parses a directive with only one list present', () => {
    const { show } = extractShowDirective('Answer.\nSHOW: events=5');
    expect(show).toEqual({ events: ['5'], monitors: [] });
  });

  it('leaves an answer without a directive untouched', () => {
    const { text, show } = extractShowDirective('There were 21 events yesterday.');
    expect(text).toBe('There were 21 events yesterday.');
    expect(show).toBeUndefined();
  });

  // Prose ABOUT the mechanism must not trigger it.
  it('ignores a SHOW mention that is not the final line', () => {
    const { text, show } = extractShowDirective('SHOW: events=1 is the machine line.\nThe answer is 42.');
    expect(text).toContain('The answer is 42.');
    expect(show).toBeUndefined();
  });

  it('tolerates trailing whitespace and empty id lists', () => {
    const { text, show } = extractShowDirective('Answer.\nSHOW: events= monitors=  \n');
    expect(text).toBe('Answer.');
    expect(show).toEqual({ events: [], monitors: [] });
  });
});

describe('filterDisplayByShow', () => {
  const cards = [event('101'), event('102'), event('103'), monitor('3')];

  it('keeps only the selected cards, by kind and id', () => {
    const kept = filterDisplayByShow(cards, { events: ['101', '103'], monitors: [] });
    expect(kept.map((c) => c.id)).toEqual(['101', '103']);
  });

  it('selects monitors independently of events', () => {
    const kept = filterDisplayByShow(cards, { events: [], monitors: ['3'] });
    expect(kept.map((c) => `${c.kind}:${c.id}`)).toEqual(['monitor:3']);
  });

  // An id the results never contained is a model mistake; hiding every card
  // over it would be worse than over-showing.
  it('falls back to every card when nothing matches', () => {
    expect(filterDisplayByShow(cards, { events: ['999'], monitors: [] })).toHaveLength(4);
    expect(filterDisplayByShow(cards, { events: [], monitors: [] })).toHaveLength(4);
  });

  // An event id cannot select a monitor card of the same id.
  it('never crosses kinds', () => {
    const kept = filterDisplayByShow([event('3'), monitor('3')], { events: ['3'], monitors: [] });
    expect(kept.map((c) => `${c.kind}:${c.id}`)).toEqual(['event:3']);
  });
});

// Refs #436, observed live: the model wrote "SHOW: events=[1,2] monitors=[4]"
// and the bracketed ids matched nothing, silently degrading to all cards.
describe('extractShowDirective bracket tolerance', () => {
  it('reads ids wrapped in brackets like bare ids', () => {
    const { show } = extractShowDirective('answer\nSHOW: events=[342702,342701] monitors=[1,4]');
    expect(show).toEqual({ events: ['342702', '342701'], monitors: ['1', '4'] });
  });
});

/**
 * refs #597: in a group turn every server's tools build cards while some other
 * profile is selected, so the event's server must come from the tool's own
 * profile, never from the resolver gate's current profile.
 */
describe('buildEventDisplayEntity server resolution (refs #597)', () => {
  const profileA = asProfileId('profile-a');
  const profileB = asProfileId('profile-b');

  afterEach(() => {
    registerServerResolverGate({ getCurrentProfileId: () => null });
    clearAllServerMaps();
  });

  it("builds the thumbnail on the tool's own profile's server while another is current", () => {
    setServerMap(
      new Map([['server-1', { recordingUrl: '', portalPath: 'https://a-server.example/index.php', apiBaseUrl: '' }]]),
      profileA,
    );
    setServerMap(
      new Map([['server-1', { recordingUrl: '', portalPath: 'https://b-server.example/index.php', apiBaseUrl: '' }]]),
      profileB,
    );
    registerServerResolverGate({ getCurrentProfileId: () => profileB });

    const monitors = [{ Monitor: { Id: '1', Name: 'Front Door', ServerId: 'server-1' } }] as unknown as MonitorData[];
    const card = buildEventDisplayEntity(
      { Id: '400', MonitorId: '1', StartDateTime: '2026-11-24 10:00:00', Notes: '', Cause: 'Motion', AlarmFrames: '0' },
      'Front Door',
      monitors,
      {
        profileId: profileA,
        portalUrl: 'https://a-portal.example/zm',
        accessToken: 'tok-a',
        thumbnailFallbackChain: [{ type: 'snapshot', enabled: true }],
      } as unknown as ToolContext,
    );

    // The dev build wraps image URLs in the image proxy, so check the decoded target.
    const url = decodeURIComponent(card.imageUrls?.[0] ?? '');
    expect(url).toContain('https://a-server.example/');
    expect(url).not.toContain('b-server.example');
  });
});
