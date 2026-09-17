import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../../api/store-gates', () => import('../../../../tests/fake-store-gates'));
vi.mock('../../../../lib/security/secureStorage', () => import('../../../../tests/fake-secure-storage'));

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(',')}` : key,
  }),
}));

import { EventContextGraph } from '../EventContextGraph';
import { useReturnHighlightStore } from '../../../../stores/returnHighlight';
import { resetProfileFixture } from '../../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../../tests/fake-store-gates';
import { EVENT_CONTEXT } from '../../../../lib/zmninja-ng-constants';
import type { EventAroundRow } from '../../../../hooks/useEventsAround';

const row = (id: string, offsetMs: number, isAnchor = false, monitorId = '3'): EventAroundRow => ({
  event: {
    Id: id,
    MonitorId: monitorId,
    Name: `Event ${id}`,
    StartDateTime: '2026-09-17 21:14:03',
    Length: '38.00',
  } as never,
  offsetMs,
  isAnchor,
});

const monitorNames = new Map([['3', 'Front Door']]);

function renderGraph(rows: EventAroundRow[], windowMinutes = 10) {
  return render(
    <MemoryRouter>
      <EventContextGraph rows={rows} monitorNames={monitorNames} windowMinutes={windowMinutes} profileId={undefined} />
    </MemoryRouter>
  );
}

afterEach(() => {
  navigate.mockClear();
  resetProfileFixture();
  resetFakeStoreGates();
  vi.unstubAllGlobals();
});

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

describe('EventContextGraph', () => {
  it('renders one node per row', () => {
    stubReducedMotion(true);
    renderGraph([row('406', 0, true), row('407', 38000)]);
    expect(screen.getByTestId('event-context-node-406')).toBeTruthy();
    expect(screen.getByTestId('event-context-node-407')).toBeTruthy();
  });

  it('names the anchor node distinctly from an offset node', () => {
    stubReducedMotion(true);
    renderGraph([row('406', 0, true), row('407', 38000)]);
    const anchor = screen.getByTestId('event-context-node-406');
    const other = screen.getByTestId('event-context-node-407');
    expect(anchor.getAttribute('aria-label')).toContain('events.around.this_event');
    expect(anchor.getAttribute('aria-label')).toContain('Front Door');
    expect(other.getAttribute('aria-label')).toContain('+38s');
    expect(other.getAttribute('aria-label')).toContain('Front Door');
  });

  it('pins the anchor node at the centre', () => {
    stubReducedMotion(true);
    renderGraph([row('406', 0, true), row('407', 38000)]);
    const anchor = screen.getByTestId('event-context-node-406');
    expect(anchor.getAttribute('data-node-x')).toBe('0');
    expect(anchor.getAttribute('data-node-y')).toBe('0');
  });

  it('lays every node in chronological tab order', () => {
    stubReducedMotion(true);
    renderGraph([row('407', 38000), row('406', 0, true), row('405', -252000)]);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.dataset.testid)).toEqual([
      'event-context-node-405',
      'event-context-node-406',
      'event-context-node-407',
    ]);
  });

  it('says how many were left out once the row count passes the cap', () => {
    stubReducedMotion(true);
    const rows = [
      row('anchor', 0, true),
      ...Array.from({ length: EVENT_CONTEXT.maxGraphNodes + 4 }, (_, i) => row(`e${i}`, (i + 1) * 1000)),
    ];
    renderGraph(rows);
    expect(screen.getByTestId('event-context-graph-truncated')).toHaveTextContent('events.around.graph_truncated:5');
  });

  it('says nothing when every row fits under the cap', () => {
    stubReducedMotion(true);
    renderGraph([row('406', 0, true), row('407', 38000)]);
    expect(screen.queryByTestId('event-context-graph-truncated')).toBeNull();
  });

  it('opens the event and marks it viewed on a tap that did not drag', () => {
    stubReducedMotion(true);
    renderGraph([row('406', 0, true), row('407', 38000)]);
    const node = screen.getByTestId('event-context-node-407');
    fireEvent.pointerDown(node, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(node, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(navigate).toHaveBeenCalledWith('/events/407', { state: { from: '/monitors/3' } });
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBe('407');
  });

  it('opens the anchor event too when it is tapped', () => {
    stubReducedMotion(true);
    renderGraph([row('406', 0, true)]);
    fireEvent.click(screen.getByTestId('event-context-node-406'));
    expect(navigate).toHaveBeenCalledWith('/events/406', { state: { from: '/monitors/3' } });
  });

  it('moves a dragged node to the pointer while held, and never navigates', () => {
    stubReducedMotion(true);
    renderGraph([row('406', 0, true), row('407', 38000)]);
    const node = screen.getByTestId('event-context-node-407');
    const before = { x: node.getAttribute('data-node-x'), y: node.getAttribute('data-node-y') };
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(node, { clientX: 60, clientY: 15, pointerId: 1 });
    const held = { x: node.getAttribute('data-node-x'), y: node.getAttribute('data-node-y') };
    expect(held).not.toEqual(before);
    expect(held).toEqual({ x: '60', y: '15' });
    fireEvent.pointerUp(node, { clientX: 60, clientY: 15, pointerId: 1 });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lets a released node settle back off the exact drop point', () => {
    stubReducedMotion(true);
    renderGraph([row('406', 0, true), row('407', 38000)]);
    const node = screen.getByTestId('event-context-node-407');
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(node, { clientX: 60, clientY: 15, pointerId: 1 });
    fireEvent.pointerUp(node, { clientX: 60, clientY: 15, pointerId: 1 });
    const released = { x: node.getAttribute('data-node-x'), y: node.getAttribute('data-node-y') };
    expect(released).not.toEqual({ x: '60', y: '15' });
  });

  it('keyboard-activates a node via click without needing a pointer drag', () => {
    stubReducedMotion(true);
    renderGraph([row('406', 0, true), row('407', 38000)]);
    fireEvent.click(screen.getByTestId('event-context-node-407'));
    expect(navigate).toHaveBeenCalledWith('/events/407', { state: { from: '/monitors/3' } });
  });

  it('paints a settled layout synchronously under reduced motion, with real positions', () => {
    stubReducedMotion(true);
    renderGraph([row('406', 0, true), row('407', 5000), row('408', -5000)]);
    const a = screen.getByTestId('event-context-node-407');
    expect(a.getAttribute('data-node-x')).not.toBeNull();
    expect(Number.isFinite(Number(a.getAttribute('data-node-x')))).toBe(true);
  });
});
