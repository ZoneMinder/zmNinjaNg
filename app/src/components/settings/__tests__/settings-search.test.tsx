import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { filterSettings, SettingsSearchContext } from '../settings-search';
import { CollapsibleSection, SettingsCard } from '../SettingsLayout';

function fixture(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <section data-settings-section>
      <button data-settings-section-label>Playback</button>
      <div data-settings-card>
        <div id="autoplay">Autoplay<span>Start events on open</span></div>
        <div id="speed">Default speed</div>
      </div>
    </section>
    <section data-settings-section id="advanced">
      <button data-settings-section-label>Advanced</button>
      <div data-settings-card id="log-card">
        <div id="log">Log level<span>How much the app writes</span></div>
      </div>
      <div data-settings-section id="component-logs">
        <button data-settings-section-label>Component log levels</button>
        <div data-settings-card><div id="http">HTTP</div></div>
      </div>
    </section>
    <div data-settings-card id="bare"><div id="grid">Grid layout</div></div>`;
  return root;
}

const shown = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLElement>(`#${id}`)!.style.display !== 'none';

describe('filterSettings', () => {
  it('matches descriptions, case-insensitively, and hides what does not match', () => {
    const root = fixture();
    expect(filterSettings(root, 'EVENTS ON')).toBe(true);
    expect(shown(root, 'autoplay')).toBe(true);
    expect(shown(root, 'speed')).toBe(false);
    expect(shown(root, 'log-card')).toBe(false);
    expect(shown(root, 'advanced')).toBe(false);
    expect(shown(root, 'bare')).toBe(false);
  });

  it('keeps every row of a section whose title matches', () => {
    const root = fixture();
    filterSettings(root, 'playback');
    expect(shown(root, 'autoplay')).toBe(true);
    expect(shown(root, 'speed')).toBe(true);
  });

  it('treats a section inside a section as part of it', () => {
    const root = fixture();
    filterSettings(root, 'component log');
    expect(shown(root, 'http')).toBe(true);
    expect(shown(root, 'advanced')).toBe(true);
    expect(shown(root, 'log')).toBe(false);

    filterSettings(root, 'speed');
    expect(shown(root, 'component-logs')).toBe(false);

    filterSettings(root, 'advanced');
    expect(shown(root, 'http')).toBe(true);
  });

  it('filters cards that sit outside any section', () => {
    const root = fixture();
    filterSettings(root, 'grid');
    expect(shown(root, 'grid')).toBe(true);
    expect(shown(root, 'autoplay')).toBe(false);
  });

  it('reports no match, and an empty query shows everything again', () => {
    const root = fixture();
    expect(filterSettings(root, 'zzz')).toBe(false);
    filterSettings(root, '  ');
    for (const id of ['autoplay', 'speed', 'log', 'advanced', 'bare']) {
      expect(shown(root, id)).toBe(true);
    }
  });
});

describe('CollapsibleSection while searching', () => {
  beforeEach(() => localStorage.clear());

  it('shows a collapsed section and leaves its remembered state alone', () => {
    localStorage.setItem('zmng-settings-section-open-advanced', 'false');
    render(
      <SettingsSearchContext.Provider value="log">
        <CollapsibleSection id="advanced" label="Advanced">
          <SettingsCard><div>Log level</div></SettingsCard>
        </CollapsibleSection>
      </SettingsSearchContext.Provider>,
    );
    expect(screen.getByText('Log level')).toBeTruthy();
    expect(localStorage.getItem('zmng-settings-section-open-advanced')).toBe('false');
  });
});

// The page-level gate (pages/__tests__/Settings.test.tsx) only sees what its
// fixture renders; a disclosure behind a provider or a server feature can
// escape it. Every settings file that folds content must open it for search.
describe('settings disclosures open for search', () => {
  it('every file with a Collapsible or aria-expanded calls useSettingsSearching', () => {
    const dir = path.resolve(__dirname, '..');
    const missing = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        return /<Collapsible\b|aria-expanded/.test(src) && !src.includes('useSettingsSearching()');
      });
    expect(missing).toEqual([]);
  });
});
