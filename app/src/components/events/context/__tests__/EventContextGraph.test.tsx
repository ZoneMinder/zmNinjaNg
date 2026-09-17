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

const monitorNames = new Map([
  ['3', 'Front Door'],
  ['4', 'Driveway'],
]);

function renderGraph(rows: EventAroundRow[], names = monitorNames) {
  return render(
    <MemoryRouter>
      <EventContextGraph rows={rows} monitorNames={names} profileId={undefined} />
    </MemoryRouter>
  );
}

afterEach(() => {
  navigate.mockClear();
  resetProfileFixture();
  resetFakeStoreGates();
});

describe('EventContextGraph', () => {
  it('renders one node per row', () => {
    renderGraph([row('406', 0, true), row('407', 38000)]);
    expect(screen.getByTestId('event-context-node-406')).toBeTruthy();
    expect(screen.getByTestId('event-context-node-407')).toBeTruthy();
  });

  it('names the root node distinctly from a leaf node', () => {
    renderGraph([row('406', 0, true), row('407', 38000)]);
    const root = screen.getByTestId('event-context-node-406');
    const leaf = screen.getByTestId('event-context-node-407');
    expect(root.getAttribute('aria-label')).toContain('events.around.this_event');
    expect(root.getAttribute('aria-label')).toContain('Front Door');
    expect(leaf.getAttribute('aria-label')).toContain('+38s');
    expect(leaf.getAttribute('aria-label')).toContain('Front Door');
  });

  it('lays every event node in chronological tab order', () => {
    renderGraph([row('407', 38000), row('406', 0, true), row('405', -252000)]);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.dataset.testid)).toEqual([
      'event-context-node-405',
      'event-context-node-406',
      'event-context-node-407',
    ]);
  });

  it('renders one branch per camera with a non-anchor event, ordered nearest first', () => {
    renderGraph([
      row('anchor', 0, true, '3'),
      row('far', 20000, false, '4'),
      row('near', 1000, false, '5'),
    ]);
    const branches = screen.getAllByTestId(/event-context-branch-/);
    expect(branches.map((b) => b.dataset.testid)).toEqual(['event-context-branch-5', 'event-context-branch-4']);
  });

  it('gives the anchor camera no branch when it has no other events', () => {
    renderGraph([row('406', 0, true), row('407', 38000, false, '4')]);
    expect(screen.queryByTestId('event-context-branch-3')).toBeNull();
    expect(screen.getByTestId('event-context-branch-4')).toBeTruthy();
  });

  it('says how many were left out once the row count passes the cap', () => {
    const rows = [
      row('anchor', 0, true),
      ...Array.from({ length: EVENT_CONTEXT.maxGraphNodes + 4 }, (_, i) => row(`e${i}`, (i + 1) * 1000)),
    ];
    renderGraph(rows);
    expect(screen.getByTestId('event-context-graph-truncated')).toHaveTextContent('events.around.graph_truncated:5');
  });

  it('says nothing when every row fits under the cap', () => {
    renderGraph([row('406', 0, true), row('407', 38000)]);
    expect(screen.queryByTestId('event-context-graph-truncated')).toBeNull();
  });

  it('opens the event and marks it viewed on a tap that did not drag', () => {
    renderGraph([row('406', 0, true), row('407', 38000)]);
    const node = screen.getByTestId('event-context-node-407');
    fireEvent.pointerDown(node, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(node, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(navigate).toHaveBeenCalledWith('/events/407', { state: { from: '/monitors/3' } });
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBe('407');
  });

  it('opens the root event too when it is tapped', () => {
    renderGraph([row('406', 0, true)]);
    const node = screen.getByTestId('event-context-node-406');
    fireEvent.pointerDown(node, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(node, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(navigate).toHaveBeenCalledWith('/events/406', { state: { from: '/monitors/3' } });
  });

  it('keyboard-activates a node via click without needing a pointer gesture', () => {
    renderGraph([row('406', 0, true), row('407', 38000)]);
    fireEvent.click(screen.getByTestId('event-context-node-407'));
    expect(navigate).toHaveBeenCalledWith('/events/407', { state: { from: '/monitors/3' } });
  });

  it('pans the whole canvas on a drag, and never navigates', () => {
    renderGraph([row('406', 0, true), row('407', 38000)]);
    const canvas = screen.getByTestId('event-context-graph');
    const before = screen.getByTestId('event-context-graph-canvas').style.transform;
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 15, pointerId: 1 });
    const after = screen.getByTestId('event-context-graph-canvas').style.transform;
    expect(after).not.toEqual(before);
    expect(after).toContain('translate(40px, 15px)');
    fireEvent.pointerUp(canvas, { clientX: 40, clientY: 15, pointerId: 1 });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still opens the node on release when the drag stayed under the move threshold', () => {
    renderGraph([row('406', 0, true), row('407', 38000)]);
    const node = screen.getByTestId('event-context-node-407');
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(node, { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerUp(node, { clientX: 1, clientY: 1, pointerId: 1 });
    expect(navigate).toHaveBeenCalledWith('/events/407', { state: { from: '/monitors/3' } });
  });

  it('captions each node with the monitor name, monitor id, and event id', () => {
    renderGraph([row('406', 0, true), row('407', 38000)]);
    const caption = screen.getByTestId('event-context-node-caption-407');
    expect(caption.textContent).toContain('Front Door');
    expect(caption.textContent).toContain('3');
    expect(caption.textContent).toContain('407');
  });

  it('keeps the caption out of the accessible name, so it never disagrees with the aria-label', () => {
    renderGraph([row('406', 0, true), row('407', 38000)]);
    expect(screen.getByTestId('event-context-node-caption-407').getAttribute('aria-hidden')).toBe('true');
  });

  it('truncates a long monitor name in the branch label but keeps the full text in a title', () => {
    const longName = 'A Very Long Monitor Name That Should Not Blow Up The Node';
    renderGraph(
      [row('406', 0, true, '3'), row('407', 38000, false, '4')],
      new Map([['3', 'Front Door'], ['4', longName]])
    );
    expect(screen.getByTestId('event-context-branch-4').getAttribute('title')).toBe(longName);
  });

  it('labels each leaf edge with the unsigned time gap from the anchor', () => {
    renderGraph([row('406', 0, true), row('407', 38000)]);
    const label = screen.getByTestId('event-context-edge-monitor:3-407').textContent ?? '';
    expect(label).toContain('38s');
    expect(label).not.toContain('+');
    expect(label).not.toContain('−');
  });

  it('leaves the root-to-branch edge unlabelled', () => {
    renderGraph([row('406', 0, true), row('407', 38000)]);
    expect(screen.getByTestId('event-context-edge-406-monitor:3').textContent).toBe('');
  });
});
