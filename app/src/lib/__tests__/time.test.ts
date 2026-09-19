/**
 * Unit tests for timezone utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatForServer, formatForServerInTz, formatLocalDateTime, formatLocalDateTimeSeconds, resolveProfileTimezone } from '../time';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { seedProfiles, resetProfileFixture, makeProfile } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';

describe('formatForServer', () => {
  beforeEach(() => {
    // Base scenario every test in this file gets unless it re-seeds:
    // profile-1 in America/New_York, current. Not authenticated - these are
    // pure date/timezone functions, no session or HTTP path involved.
    seedProfiles([makeProfile('profile-1', { timezone: 'America/New_York' })], {
      current: 'profile-1',
      authenticated: false,
    });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('formats date in server timezone format', () => {
    const date = new Date('2024-01-15T10:30:45Z'); // UTC time
    const result = formatForServer(date);

    // Should be in format: YYYY-MM-DD HH:mm:ss
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('uses space separator not T', () => {
    const date = new Date('2024-01-15T10:30:45Z');
    const result = formatForServer(date);

    expect(result).toContain(' ');
    expect(result).not.toContain('T');
  });

  it('pads single-digit values with zeros', () => {
    const date = new Date('2024-01-05T08:09:07Z');
    const result = formatForServer(date);

    // Month, day, hour, minute, second should all be 2 digits
    const parts = result.split(/[-\s:]/);
    parts.forEach(part => {
      expect(part.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('handles midnight correctly', () => {
    const date = new Date('2024-01-15T00:00:00Z');
    const result = formatForServer(date);

    // Timezone conversion may shift hour, but format should be correct
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}$/);
  });

  it('handles end of day correctly', () => {
    const date = new Date('2024-01-15T23:59:59Z');
    const result = formatForServer(date);

    // Should be in valid format (timezone conversion may change the hour)
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}$/);
  });

  it('uses 24-hour format', () => {
    const date = new Date('2024-01-15T14:30:00Z'); // 2:30 PM UTC
    const result = formatForServer(date);

    // Should not contain AM/PM (24-hour format)
    expect(result).not.toContain('AM');
    expect(result).not.toContain('PM');
    // Should be in format HH:mm:ss
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}$/);
  });

  it('handles different months correctly', () => {
    const dates = [
      new Date('2024-01-15T12:00:00Z'),
      new Date('2024-06-15T12:00:00Z'),
      new Date('2024-12-15T12:00:00Z'),
    ];

    dates.forEach(date => {
      const result = formatForServer(date);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  it('handles leap year dates', () => {
    const date = new Date('2024-02-29T12:00:00Z'); // 2024 is a leap year
    const result = formatForServer(date);

    expect(result).toContain('2024-02-29');
  });

  it('falls back gracefully on timezone error', () => {
    seedProfiles([makeProfile('profile-1', { timezone: 'Invalid/Timezone' })], {
      current: 'profile-1',
      authenticated: false,
    });

    const date = new Date('2024-01-15T10:30:45Z');
    const result = formatForServer(date);

    // Should still return valid format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('uses browser timezone when profile has no timezone', () => {
    seedProfiles([], { current: null, authenticated: false });

    const date = new Date('2024-01-15T10:30:45Z');
    const result = formatForServer(date);

    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('formatLocalDateTimeSeconds', () => {
  // The Events filter's inputs carry step="1", so the browser reports seconds
  // back on the first keystroke. A minute-precision value there changes shape
  // mid-edit and the browser drops the segment being typed (refs #495).
  it('formats a date at the seconds precision a step=1 input reports', () => {
    expect(formatLocalDateTimeSeconds(new Date('2024-01-15T10:30:07'))).toBe('2024-01-15T10:30:07');
  });

  it('pads a single-digit second', () => {
    expect(formatLocalDateTimeSeconds(new Date('2024-01-15T10:30:04'))).toBe('2024-01-15T10:30:04');
  });

  it('keeps a whole minute at :00 rather than dropping the segment', () => {
    expect(formatLocalDateTimeSeconds(new Date('2024-01-15T10:30:00'))).toBe('2024-01-15T10:30:00');
  });
});

describe('formatLocalDateTime', () => {
  it('formats date for datetime-local input', () => {
    const date = new Date('2024-01-15T10:30:00');
    const result = formatLocalDateTime(date);

    expect(result).toBe('2024-01-15T10:30');
  });

  it('uses T separator between date and time', () => {
    const date = new Date('2024-01-15T10:30:00');
    const result = formatLocalDateTime(date);

    expect(result).toContain('T');
    expect(result.split('T')).toHaveLength(2);
  });

  it('pads single-digit months with zeros', () => {
    const date = new Date('2024-01-15T10:30:00');
    const result = formatLocalDateTime(date);

    expect(result).toContain('2024-01-');
  });

  it('pads single-digit days with zeros', () => {
    const date = new Date('2024-01-05T10:30:00');
    const result = formatLocalDateTime(date);

    expect(result).toContain('-05T');
  });

  it('pads single-digit hours with zeros', () => {
    const date = new Date('2024-01-15T08:30:00');
    const result = formatLocalDateTime(date);

    expect(result).toContain('T08:');
  });

  it('pads single-digit minutes with zeros', () => {
    const date = new Date('2024-01-15T10:05:00');
    const result = formatLocalDateTime(date);

    expect(result).toContain(':05');
  });

  it('handles midnight', () => {
    const date = new Date('2024-01-15T00:00:00');
    const result = formatLocalDateTime(date);

    expect(result).toBe('2024-01-15T00:00');
  });

  it('handles end of day', () => {
    const date = new Date('2024-01-15T23:59:00');
    const result = formatLocalDateTime(date);

    expect(result).toBe('2024-01-15T23:59');
  });

  it('uses 24-hour format', () => {
    const date = new Date('2024-01-15T14:30:00'); // 2:30 PM
    const result = formatLocalDateTime(date);

    expect(result).toBe('2024-01-15T14:30');
    expect(result).not.toContain('PM');
  });

  it('handles different months', () => {
    const testCases = [
      { date: new Date('2024-01-15T10:30:00'), expected: '2024-01-15T10:30' },
      { date: new Date('2024-06-15T10:30:00'), expected: '2024-06-15T10:30' },
      { date: new Date('2024-12-15T10:30:00'), expected: '2024-12-15T10:30' },
    ];

    testCases.forEach(({ date, expected }) => {
      expect(formatLocalDateTime(date)).toBe(expected);
    });
  });

  it('handles leap year', () => {
    const date = new Date('2024-02-29T12:00:00');
    const result = formatLocalDateTime(date);

    expect(result).toBe('2024-02-29T12:00');
  });

  it('does not include seconds', () => {
    const date = new Date('2024-01-15T10:30:45');
    const result = formatLocalDateTime(date);

    expect(result).toBe('2024-01-15T10:30');
    expect(result).not.toContain(':45');
  });

  it('handles year boundaries correctly', () => {
    const testCases = [
      { date: new Date('2023-12-31T23:59:00'), expected: '2023-12-31T23:59' },
      { date: new Date('2024-01-01T00:00:00'), expected: '2024-01-01T00:00' },
    ];

    testCases.forEach(({ date, expected }) => {
      expect(formatLocalDateTime(date)).toBe(expected);
    });
  });
});

describe('formatForServerInTz', () => {
  beforeEach(() => {
    seedProfiles([makeProfile('profile-1', { timezone: 'America/New_York' })], {
      current: 'profile-1',
      authenticated: false,
    });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  // A single instant, converted into two different IANA zones, must produce
  // the two zones' own distinct wall-clock digits - the per-profile
  // conversion All-mode aggregation fan-outs rely on (refs #337).
  const instant = new Date('2026-01-15T15:30:00Z');

  it('formats the same instant differently per timezone', () => {
    expect(formatForServerInTz(instant, 'UTC')).toBe('2026-01-15 15:30:00');
    expect(formatForServerInTz(instant, 'America/New_York')).toBe('2026-01-15 10:30:00');
  });

  it('matches formatForServer when given the current profile\'s own timezone', () => {
    // The current profile (seeded above) is profile-1 @ America/New_York.
    expect(formatForServerInTz(instant, 'America/New_York')).toBe(formatForServer(instant));
  });
});

describe('resolveProfileTimezone', () => {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  it('returns the given timezone when present', () => {
    expect(resolveProfileTimezone('America/New_York')).toBe('America/New_York');
  });

  // refs #337 fix round 1: a timezone-less profile must fall back to the
  // BROWSER zone (formatForServer's historical fallback), not 'UTC' - the
  // All-mode aggregation hooks were silently shifting the query window for
  // such a profile before this helper unified the fallback.
  it('falls back to the browser zone, not UTC, when the profile has no timezone', () => {
    expect(resolveProfileTimezone(undefined)).toBe(browserTz);
    expect(resolveProfileTimezone(null)).toBe(browserTz);
    expect(resolveProfileTimezone('')).toBe(browserTz);
  });
});
