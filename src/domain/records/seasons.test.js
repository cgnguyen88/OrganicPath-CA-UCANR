import { describe, it, expect } from 'vitest';
import { seasonRange, todayLocalIso, previousDay, seasonPeriod, monthsBefore } from './seasons.js';

const farm = (month, day) => ({ season_start_month: month, season_start_day: day });

describe('seasonRange', () => {
  it('uses the calendar year when the season starts on Jan 1 (the default)', () => {
    expect(seasonRange(farm(1, 1), '2026-10-12')).toEqual({ start: '2026-01-01', end: '2027-01-01', label: '2026' });
  });

  it('returns the season that has already started this year', () => {
    expect(seasonRange(farm(4, 1), '2026-10-12')).toEqual({ start: '2026-04-01', end: '2027-04-01', label: '2026' });
  });

  it('returns last year’s season when the new one has not started yet', () => {
    expect(seasonRange(farm(4, 1), '2026-02-10')).toEqual({ start: '2025-04-01', end: '2026-04-01', label: '2025' });
  });

  it('treats the first day of a season as inside it, and the day before as the previous one', () => {
    expect(seasonRange(farm(4, 1), '2026-04-01').start).toBe('2026-04-01');
    expect(seasonRange(farm(4, 1), '2026-03-31').start).toBe('2025-04-01');
  });

  it('can return the previous season', () => {
    expect(seasonRange(farm(4, 1), '2026-10-12', -1)).toEqual({ start: '2025-04-01', end: '2026-04-01', label: '2025' });
  });

  it('clamps an impossible day (Feb 30, Apr 31) to the last day of that month instead of rolling over', () => {
    expect(seasonRange(farm(2, 30), '2026-10-12').start).toBe('2026-02-28');
    expect(seasonRange(farm(2, 30), '2028-10-12').start).toBe('2028-02-29');
    expect(seasonRange(farm(4, 31), '2026-10-12').start).toBe('2026-04-30');
  });

  it('falls back to January 1 for missing or invalid settings', () => {
    expect(seasonRange({}, '2026-10-12').start).toBe('2026-01-01');
    expect(seasonRange(null, '2026-10-12').start).toBe('2026-01-01');
    expect(seasonRange(farm(13, 1), '2026-10-12').start).toBe('2026-01-01');
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(seasonRange(farm(1, 1), new Date('2026-10-12T12:00:00Z')).start).toBe('2026-01-01');
  });
});

describe('todayLocalIso', () => {
  it('formats the LOCAL calendar date, not the UTC date (a 6 pm Pacific entry is still today)', () => {
    // 2026-10-13T01:30:00Z is 6:30 pm on Oct 12 in California; this constructor uses local fields.
    expect(todayLocalIso(new Date(2026, 9, 12, 18, 30))).toBe('2026-10-12');
  });

  it('zero-pads month and day', () => {
    expect(todayLocalIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('defaults to now and returns an ISO date', () => {
    expect(todayLocalIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('previousDay', () => {
  it('gives the day before, across month and year ends', () => {
    expect(previousDay('2026-10-14')).toBe('2026-10-13');
    expect(previousDay('2026-11-01')).toBe('2026-10-31');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
    expect(previousDay('2027-04-01')).toBe('2027-03-31');
  });

  it('knows about leap years', () => {
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
    expect(previousDay('2027-03-01')).toBe('2027-02-28');
  });

  it('turns a season’s exclusive end into the last day of the season', () => {
    const season = seasonRange({ season_start_month: 4, season_start_day: 1 }, '2026-10-14');
    expect(previousDay(season.end)).toBe('2027-03-31');
  });
});

describe('seasonPeriod', () => {
  const farm = { season_start_month: 4, season_start_day: 1 };

  it('gives the first and the last day of this season', () => {
    expect(seasonPeriod(farm, '2026-10-14', 0)).toEqual({ from: '2026-04-01', to: '2027-03-31' });
  });

  it('gives last season, and the one before it', () => {
    expect(seasonPeriod(farm, '2026-10-14', -1)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(seasonPeriod(farm, '2026-10-14', -2)).toEqual({ from: '2024-04-01', to: '2025-03-31' });
  });

  it('is the calendar year for a farm with no season start', () => {
    expect(seasonPeriod(null, '2026-10-14', 0)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('looks at this season by default', () => {
    expect(seasonPeriod(farm, '2026-10-14')).toEqual({ from: '2026-04-01', to: '2027-03-31' });
  });
});

describe('monthsBefore', () => {
  it('goes back the number of months, keeping the day', () => {
    expect(monthsBefore('2026-10-14', 12)).toBe('2025-10-14');
    expect(monthsBefore('2026-10-14', 3)).toBe('2026-07-14');
    expect(monthsBefore('2026-10-14', 0)).toBe('2026-10-14');
  });

  it('crosses year ends', () => {
    expect(monthsBefore('2026-02-10', 3)).toBe('2025-11-10');
    expect(monthsBefore('2026-01-31', 1)).toBe('2025-12-31');
    expect(monthsBefore('2026-10-14', 60)).toBe('2021-10-14');
  });

  it('uses the last day of a shorter month rather than spilling into the next', () => {
    expect(monthsBefore('2026-03-31', 1)).toBe('2026-02-28');
    expect(monthsBefore('2028-03-31', 1)).toBe('2028-02-29');
    expect(monthsBefore('2028-02-29', 12)).toBe('2027-02-28');
    expect(monthsBefore('2026-10-31', 4)).toBe('2026-06-30');
  });
});

