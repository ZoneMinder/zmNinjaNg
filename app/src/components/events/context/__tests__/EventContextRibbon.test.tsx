import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventContextRibbon } from '../EventContextRibbon';
import { buildRibbonLanes } from '../../../../lib/event/event-context-view';

// Mirrors the real "{{camera}}, {{offset}}" resource string (en/translation.json)
// so the interpolation the component relies on is actually exercised, rather
// than the no-instance fallback that hands back the raw key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'events.around.dot_label') return `${opts?.camera}, ${opts?.offset}`;
      if (key === 'events.around.ribbon_count') return `${opts?.count} cameras`;
      return key;
    },
    // A partial stub of this hook is a trap: a component reading i18n.language
    // only on some branches crashes the day that branch starts running.
    i18n: { language: 'en' },
  }),
}));

const rows = [
  { event: { Id: '405', MonitorId: '4' } as never, offsetMs: -300_000, isAnchor: false },
  { event: { Id: '406', MonitorId: '3' } as never, offsetMs: 0, isAnchor: true },
  { event: { Id: '407', MonitorId: '4' } as never, offsetMs: 300_000, isAnchor: false },
];
const names = new Map([['3', 'Door'], ['4', 'Drive']]);

describe('buildRibbonLanes', () => {
  it('gives each camera one lane holding its own events', () => {
    const lanes = buildRibbonLanes(rows, names, 600_000);
    expect(lanes.map((l) => l.monitorId)).toEqual(['4', '3']);
    expect(lanes[0].dots.map((d) => d.eventId)).toEqual(['405', '407']);
  });

  it('places the anchor in the middle and the edges at the ends', () => {
    const [drive, door] = buildRibbonLanes(rows, names, 600_000);
    expect(door.dots[0].leftPercent).toBe(50);
    expect(drive.dots[0].leftPercent).toBe(0);
    expect(drive.dots[1].leftPercent).toBe(100);
  });

  it('names a camera it has no name for by its id', () => {
    const lanes = buildRibbonLanes(rows, new Map(), 600_000);
    expect(lanes[0].monitorName).toBe('4');
  });
});

describe('EventContextRibbon', () => {
  it('renders nothing when the window holds a single event', () => {
    const lanes = buildRibbonLanes([rows[1]], names, 600_000);
    const { container } = render(<EventContextRibbon lanes={lanes} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still plots one camera that has several events', () => {
    const sameCamera = [rows[0], rows[2]];
    const lanes = buildRibbonLanes(sameCamera, names, 600_000);
    expect(lanes).toHaveLength(1);
    render(<EventContextRibbon lanes={lanes} onSelect={vi.fn()} />);
    expect(screen.getByTestId('event-context-dot-405')).toHaveAccessibleName(/Drive/);
    expect(screen.getByTestId('event-context-dot-407')).toHaveAccessibleName(/Drive/);
  });

  it('reports the event behind a dot the user pressed', () => {
    const onSelect = vi.fn();
    render(<EventContextRibbon lanes={buildRibbonLanes(rows, names, 600_000)} onSelect={onSelect} />);
    screen.getByTestId('event-context-dot-407').click();
    expect(onSelect).toHaveBeenCalledWith('407');
  });

  it('labels each dot with its camera and offset for a screen reader', () => {
    render(<EventContextRibbon lanes={buildRibbonLanes(rows, names, 600_000)} onSelect={vi.fn()} />);
    expect(screen.getByTestId('event-context-dot-405')).toHaveAccessibleName(/Drive/);
  });
});

describe('EventContextRibbon collapse (refs #494)', () => {
  const lanes = buildRibbonLanes(rows, names, 600_000);

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts expanded with every lane visible', () => {
    render(<EventContextRibbon lanes={lanes} onSelect={vi.fn()} />);
    expect(screen.getByTestId('event-context-ribbon-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('event-context-dot-405')).toBeInTheDocument();
  });

  it('collapsing hides the lanes and shows the lane count instead', () => {
    render(<EventContextRibbon lanes={lanes} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId('event-context-ribbon-toggle'));
    const toggle = screen.getByTestId('event-context-ribbon-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('2 cameras');
    expect(screen.queryByTestId('event-context-dot-405')).toBeNull();
  });

  it('remembers a collapsed choice across a remount', () => {
    const { unmount } = render(<EventContextRibbon lanes={lanes} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId('event-context-ribbon-toggle'));
    unmount();

    render(<EventContextRibbon lanes={lanes} onSelect={vi.fn()} />);
    expect(screen.getByTestId('event-context-ribbon-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('event-context-dot-405')).toBeNull();
  });

  it('defaults to expanded when the stored choice cannot be read', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<EventContextRibbon lanes={lanes} onSelect={vi.fn()} />);
    expect(screen.getByTestId('event-context-ribbon-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('still collapses when the choice cannot be saved', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<EventContextRibbon lanes={lanes} onSelect={vi.fn()} />);
    expect(() => fireEvent.click(screen.getByTestId('event-context-ribbon-toggle'))).not.toThrow();
    expect(screen.getByTestId('event-context-ribbon-toggle')).toHaveAttribute('aria-expanded', 'false');
  });
});
