import { expect, test } from 'bun:test';
import { computeChart } from '../src/core/chart';

// Nothing in the correctness suite asks how long a chart takes, and an MCP tool
// call that overruns a client's timeout fails just as hard as a wrong answer.
// Integrating small bodies from J2000 alone once put a 1900 chart with
// asteroids at 4.7 s; seeding every 20 years brought it to ~450 ms.
//
// The budget is expressed as a RATIO against a plain chart measured on the same
// machine, not as a wall-clock constant. A fixed millisecond ceiling tuned on a
// laptop fails on a CI runner two or three times slower -- which is what
// happened to the first version of this file, reporting a red build for a
// perfectly healthy commit. The regression actually worth catching is
// structural (single-epoch seeding costs ~50x a plain chart, multi-epoch ~11x),
// and a ratio detects that on any hardware.
const MAX_ASTEROID_RATIO = 25;

// A loose absolute ceiling still catches pathological slowness on any machine
// a human would plausibly run this on. Deliberately far above the ~450 ms
// measured locally so that ordinary CI-runner slowness never trips it.
const ABSOLUTE_CEILING_MS = 8000;

const at = (year: number, extra: Record<string, unknown> = {}) => ({
  solarDate: { year, month: 6, day: 15 }, clockTime: { hour: 20, minute: 0 },
  longitude: -118.24, latitude: 34.05, timezone: 'America/Los_Angeles', ...extra,
});

const timeMs = (input: unknown): number => {
  const t = Bun.nanoseconds();
  computeChart(input as never);
  return (Bun.nanoseconds() - t) / 1e6;
};

/** Slowest plain chart across the range, as this machine's yardstick. */
function baselineMs(): number {
  const samples = [1900, 1937, 1990, 2026, 2073, 2100].map((y) => timeMs(at(y)));
  return Math.max(...samples, 1);   // floor at 1ms so a very fast host cannot make the ratio meaningless
}

test('asteroid charts stay within a sane multiple of a plain chart', () => {
  const base = baselineMs();
  // Seeds sit every 20 years from 1900, so years ending in 10 or 11 are the
  // farthest any integration ever has to run from its nearest epoch.
  for (const year of [1911, 1950, 1991, 2031, 2091]) {
    const ms = timeMs(at(year, { asteroids: true }));
    expect(ms).toBeLessThan(base * MAX_ASTEROID_RATIO);
    expect(ms).toBeLessThan(ABSOLUTE_CEILING_MS);
  }
});

test('a plain chart never approaches the absolute ceiling anywhere in range', () => {
  for (const year of [1900, 1937, 1990, 2026, 2073, 2100]) {
    expect(timeMs(at(year))).toBeLessThan(ABSOLUTE_CEILING_MS);
  }
});

test('the unknown-time modes stay bounded -- they evaluate many instants', () => {
  for (const extra of [
    { clockTime: undefined },
    { clockTime: undefined, clockTimeRange: { from: { hour: 18, minute: 0 }, to: { hour: 23, minute: 59 } } },
  ]) {
    expect(timeMs({ ...at(1950), ...extra })).toBeLessThan(ABSOLUTE_CEILING_MS);
  }
});
