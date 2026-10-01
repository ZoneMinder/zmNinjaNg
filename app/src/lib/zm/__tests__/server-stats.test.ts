import { describe, expect, it } from 'vitest';
import { zmHumanFilesize, zmLowFree, zmThisServerId, zmUsageLevel } from '../server-stats';

describe('zmHumanFilesize', () => {
  it('matches the sizes the ZoneMinder console shows', () => {
    // Read off a ZoneMinder 1.39 console: "69.35GB of 97.87GB".
    expect(zmHumanFilesize(74462892032)).toBe('69.35 GB');
    expect(zmHumanFilesize(105089261568)).toBe('97.87 GB');
    expect(zmHumanFilesize(8589930496)).toBe('8.00 GB');
    expect(zmHumanFilesize(0)).toBe('0.00 B');
  });

  it('moves up a unit once the value passes 0.9 of the next one', () => {
    expect(zmHumanFilesize(1000)).toBe('0.98 kB');
    expect(zmHumanFilesize(900)).toBe('900.00 B');
  });
});

describe('zmUsageLevel', () => {
  it('warns above the warning line and alarms above the danger line', () => {
    expect(zmUsageLevel(95, 95, 98)).toBeUndefined();
    expect(zmUsageLevel(96, 95, 98)).toBe('warning');
    expect(zmUsageLevel(98, 95, 98)).toBe('warning');
    expect(zmUsageLevel(99, 95, 98)).toBe('danger');
  });
});

describe('zmThisServerId', () => {
  const servers = [
    { Id: '2', Name: 'pseudo', Hostname: 'pseudo.example.com' },
    { Id: '13', Name: 'unicron', Hostname: 'Unicron.example.com' },
  ];

  it('picks the server whose hostname the profile talks to', () => {
    expect(zmThisServerId(servers, 'https://unicron.example.com:8443/zm/api')).toBe('13');
  });

  it('falls back to 0, where single-server zmstats writes, when no hostname matches', () => {
    expect(zmThisServerId(servers, 'https://zm.example.com/zm/api')).toBe('0');
    expect(zmThisServerId([], 'https://zm.example.com/zm/api')).toBe('0');
    expect(zmThisServerId(servers, 'not a url')).toBe('0');
  });
});

describe('zmLowFree', () => {
  it('flags under a tenth free, or no total at all, as the Servers table does', () => {
    expect(zmLowFree(0, 8589930496)).toBe(true);
    expect(zmLowFree(858993049, 8589930496)).toBe(true);
    expect(zmLowFree(858993050, 8589930496)).toBe(false);
    expect(zmLowFree(0, 0)).toBe(true);
  });
});
