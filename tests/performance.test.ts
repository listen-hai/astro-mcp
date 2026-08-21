import { expect, test } from 'bun:test';
import { computeChart } from '../src/core/chart';

// Nothing in the correctness suite asks how long a chart takes, and an MCP
// tool call that overruns a client's timeout fails just as hard as a wrong
// answer. Integrating small bodies from J2000 alone once put a 1900 chart
// with asteroids at 4.7 s; seeding every 20 years brought it to ~450 ms.
const BUDGET_MS = 500;

const at = (year: number, extra: Record<string, unknown> = {}) => ({
  solarDate: { year, month: 6, day: 15 }, clockTime: { hour: 20, minute: 0 },
  longitude: -118.24, latitude: 34.05, timezone: 'America/Los_Angeles', ...extra,
});

test('a default chart is fast across the whole supported range', () => {
  for (const year of [1900, 1937, 1990, 2026, 2073, 2100]) {
    const t = Bun.nanoseconds();
    computeChart(at(year) as never);
    expect((Bun.nanoseconds() - t) / 1e6).toBeLessThan(BUDGET_MS);
  }
});

test('even the worst case -- asteroids, mid-way between seed epochs -- fits the budget', () => {
  // Seeds sit every 20 years from 1900, so years ending in 10 or 11 are the
  // farthest an integration ever has to run.
  for (const year of [1911, 1950, 1991, 2031, 2091]) {
    const t = Bun.nanoseconds();
    computeChart(at(year, { asteroids: true }) as never);
    const ms = (Bun.nanoseconds() - t) / 1e6;
    expect(ms).toBeLessThan(BUDGET_MS);
  }
});

test('the unknown-time modes stay fast too -- they evaluate many instants', () => {
  for (const extra of [
    { clockTime: undefined },
    { clockTime: undefined, clockTimeRange: { from: { hour: 18, minute: 0 }, to: { hour: 23, minute: 59 } } },
  ]) {
    const t = Bun.nanoseconds();
    computeChart({ ...at(1950), ...extra } as never);
    expect((Bun.nanoseconds() - t) / 1e6).toBeLessThan(BUDGET_MS * 2);
  }
});
