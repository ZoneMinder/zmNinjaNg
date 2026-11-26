/**
 * Hover delay setting (refs #611): a hover preview waits the delay stored in
 * the current selection's settings, and 700 ms when none is stored.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { HoverPreview } from '../hover-preview';
import { useProfileStore } from '../../../stores/profile';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../../stores/settings';
import { asProfileId } from '../../../api/types';

function hoverTrigger() {
  render(
    <HoverPreview aspectRatio={16 / 9} testId="preview" renderPreview={() => <div>preview</div>}>
      <img data-testid="trigger" src="x" alt="" />
    </HoverPreview>,
  );
  fireEvent.mouseEnter(screen.getByTestId('trigger').parentElement as HTMLElement);
}

function previewOpenAfter(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
  return screen.queryByTestId('preview') !== null;
}

describe('HoverPreview delay setting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useProfileStore.setState({ currentProfileId: asProfileId('profile-1') });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('opens after the stored hover delay', () => {
    useSettingsStore.setState({
      profileSettings: { 'profile-1': { ...DEFAULT_SETTINGS, hoverPreviewDelayMs: 300 } },
    });
    hoverTrigger();

    expect(previewOpenAfter(299)).toBe(false);
    expect(previewOpenAfter(1)).toBe(true);
  });

  it('opens after 700 ms when no delay is stored', () => {
    useSettingsStore.setState({ profileSettings: {} });
    hoverTrigger();

    expect(previewOpenAfter(699)).toBe(false);
    expect(previewOpenAfter(1)).toBe(true);
  });
});
