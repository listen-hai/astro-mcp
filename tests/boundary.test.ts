import { expect, test } from 'bun:test';
import { wallToUtc } from '../src/core/time';
import { ASTRO_YEAR_MIN, ASTRO_YEAR_MAX, yearRangeMessage, AstroInputSchema } from '../src/schemas/input';

test('DST spring-forward gap must throw, never silently shift', () => {
  // 2023-03-12 02:30 America/Los_Angeles does not exist (02:00 jumps to 03:00)
  expect(() => wallToUtc(2023, 3, 12, 2, 30, 'America/Los_Angeles', 0))
    .toThrow(/does not exist/i);
});

test('DST fall-back repeated hour: fold 0 and 1 differ by exactly one hour', () => {
  const a = wallToUtc(2023, 11, 5, 1, 30, 'America/Los_Angeles', 0);
  const b = wallToUtc(2023, 11, 5, 1, 30, 'America/Los_Angeles', 1);
  expect(b.getTime() - a.getTime()).toBe(3600_000);
});

test('an ordinary time round-trips to the right UTC instant', () => {
  // 1990-06-15 20:00 PDT (UTC-7) -> 1990-06-16 03:00 UTC
  expect(wallToUtc(1990, 6, 15, 20, 0, 'America/Los_Angeles', 0).toISOString())
    .toBe('1990-06-16T03:00:00.000Z');
  // Beijing is UTC+8 year-round
  expect(wallToUtc(1990, 6, 15, 20, 0, 'Asia/Shanghai', 0).toISOString())
    .toBe('1990-06-15T12:00:00.000Z');
});

test('southern-hemisphere DST runs the other way round', () => {
  // Sydney is UTC+10 standard, UTC+11 during its (Oct-Apr) DST
  expect(wallToUtc(1990, 1, 15, 12, 0, 'Australia/Sydney', 0).toISOString())
    .toBe('1990-01-15T01:00:00.000Z');
  expect(wallToUtc(1990, 7, 15, 12, 0, 'Australia/Sydney', 0).toISOString())
    .toBe('1990-07-15T02:00:00.000Z');
});

test('year range uses one shared constant and message', () => {
  expect(ASTRO_YEAR_MIN).toBe(1900);
  expect(ASTRO_YEAR_MAX).toBe(2100);
  expect(yearRangeMessage('Solar year')).toContain('1900');
  expect(yearRangeMessage('Solar year')).toContain('2100');
});

test('years outside 1900-2100 are rejected at the schema layer', () => {
  for (const year of [1899, 2101]) {
    const r = AstroInputSchema.safeParse({
      solarDate: { year, month: 6, day: 15 },
      clockTime: { hour: 20, minute: 0 }, place: 'Los Angeles',
    });
    expect(r.success).toBe(false);
  }
});
