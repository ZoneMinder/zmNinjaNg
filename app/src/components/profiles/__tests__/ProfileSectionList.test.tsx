import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ProfileSectionList } from '../ProfileSectionList';
import { asProfileId } from '../../../api/types';
import type { ProfileSections } from '../../../lib/profile/profile-sections';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const scopeId = asProfileId('group-1');

type Item = { id: string };

function sections(): ProfileSections<Item> {
  return [
    [asProfileId('profile-1'), { profileName: 'Home', items: [{ id: 'a' }, { id: 'b' }] }],
    [asProfileId('profile-2'), { profileName: 'Office', items: [{ id: 'c' }] }],
  ];
}

function renderList() {
  return render(
    <ProfileSectionList
      sections={sections()}
      surface="events-group"
      scopeId={scopeId}
      renderItems={(items) => (
        <div>
          {items.map((item) => (
            <span key={item.id} data-testid="item">{item.id}</span>
          ))}
        </div>
      )}
    />
  );
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  localStorage.clear();
  scrollIntoView.mockClear();
  // jsdom has no layout, so Element.scrollIntoView is not implemented.
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  localStorage.clear();
});

describe('ProfileSectionList', () => {
  it('heads each section with its server name and item count', () => {
    renderList();

    const home = screen.getByTestId('events-group-toggle-profile-1');
    expect(home).toHaveTextContent('Home');
    expect(home).toHaveTextContent('2');
    expect(home).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('events-group-toggle-profile-2')).toHaveTextContent('Office');
  });

  it('offers one jump button per section, carrying the same counts', () => {
    renderList();

    const bar = screen.getByTestId('events-group-jump-bar');
    const buttons = within(bar).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Home2', 'Office1']);
  });

  it('scrolls a section into view when its jump button is pressed', () => {
    renderList();

    fireEvent.click(screen.getByTestId('events-group-jump-profile-2'));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId('events-group-section-profile-2'));
  });

  it('hides a section\'s items when its header is pressed, leaving the others alone', () => {
    renderList();
    expect(screen.getAllByTestId('item').map((i) => i.textContent)).toEqual(['a', 'b', 'c']);

    fireEvent.click(screen.getByTestId('events-group-toggle-profile-1'));

    expect(screen.getAllByTestId('item').map((i) => i.textContent)).toEqual(['c']);
    expect(screen.getByTestId('events-group-toggle-profile-1')).toHaveAttribute('aria-expanded', 'false');
    // The section itself stays, with its header and count: collapsing is not
    // filtering.
    expect(screen.getByTestId('events-group-toggle-profile-1')).toHaveTextContent('2');
  });

  it('expands a collapsed section when its jump button is pressed', () => {
    renderList();
    fireEvent.click(screen.getByTestId('events-group-toggle-profile-2'));
    expect(screen.getAllByTestId('item').map((i) => i.textContent)).toEqual(['a', 'b']);

    fireEvent.click(screen.getByTestId('events-group-jump-profile-2'));

    expect(screen.getAllByTestId('item').map((i) => i.textContent)).toEqual(['a', 'b', 'c']);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('remembers a collapsed section per surface, group and profile', () => {
    const first = renderList();
    fireEvent.click(screen.getByTestId('events-group-toggle-profile-1'));
    first.unmount();

    renderList();

    expect(screen.getByTestId('events-group-toggle-profile-1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('events-group-toggle-profile-2')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByTestId('item').map((i) => i.textContent)).toEqual(['c']);
  });

  it('keeps another group\'s collapse state out of this one', () => {
    const first = renderList();
    fireEvent.click(screen.getByTestId('events-group-toggle-profile-1'));
    first.unmount();

    render(
      <ProfileSectionList
        sections={sections()}
        surface="events-group"
        scopeId={asProfileId('group-2')}
        renderItems={(items) => <span data-testid="item">{items.length}</span>}
      />
    );

    expect(screen.getByTestId('events-group-toggle-profile-1')).toHaveAttribute('aria-expanded', 'true');
  });

  // Switching groups from the profile switcher changes scopeId under a page
  // that stays mounted. The fold belongs to the group it was made in.
  it('drops a fold when the group changes without a remount', () => {
    const view = render(
      <ProfileSectionList
        sections={sections()}
        surface="events-group"
        scopeId={scopeId}
        renderItems={(items) => <span data-testid="item">{items.length}</span>}
      />
    );
    fireEvent.click(screen.getByTestId('events-group-toggle-profile-1'));
    expect(screen.getByTestId('events-group-toggle-profile-1')).toHaveAttribute('aria-expanded', 'false');

    view.rerender(
      <ProfileSectionList
        sections={sections()}
        surface="events-group"
        scopeId={asProfileId('group-2')}
        renderItems={(items) => <span data-testid="item">{items.length}</span>}
      />
    );

    expect(screen.getByTestId('events-group-toggle-profile-1')).toHaveAttribute('aria-expanded', 'true');

    view.rerender(
      <ProfileSectionList
        sections={sections()}
        surface="events-group"
        scopeId={scopeId}
        renderItems={(items) => <span data-testid="item">{items.length}</span>}
      />
    );

    expect(screen.getByTestId('events-group-toggle-profile-1')).toHaveAttribute('aria-expanded', 'false');
  });

  // A group's servers answer one after another, so a section can appear after
  // the first render; its stored fold still applies.
  it('folds a section that appears after the first render', () => {
    const view = render(
      <ProfileSectionList
        sections={[sections()[0]]}
        surface="events-group"
        scopeId={scopeId}
        renderItems={(items) => <span data-testid="item">{items.length}</span>}
      />
    );
    localStorage.setItem('zmng-profile-section-open-events-group-group-1-profile-2', 'false');

    view.rerender(
      <ProfileSectionList
        sections={sections()}
        surface="events-group"
        scopeId={scopeId}
        renderItems={(items) => <span data-testid="item">{items.length}</span>}
      />
    );

    expect(screen.getByTestId('events-group-toggle-profile-2')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('events-group-toggle-profile-1')).toHaveAttribute('aria-expanded', 'true');
  });
});
