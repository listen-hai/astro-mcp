import { expect, test } from 'bun:test';
import { integrationSpanYears, SMALL_BODIES } from '../src/ephemeris/smallbodies';
import seeds from '../src/ephemeris/seeds.json';
import { computeChart } from '../src/core/chart';

// Integrating every small body from J2000 alone once put a 1900 chart with
// asteroids at 4.7 s -- long enough to trip an MCP client timeout, which fails
// as hard as a wrong answer. Seeding every 20 years capped it at ~450 ms.
//
// Two earlier versions of this file asserted that in milliseconds -- first an
// absolute 500 ms ceiling, then a ratio against a plain chart. Both went red on
// CI hardware two to three times slower than the machine they were written on,
// reporting broken builds for healthy commits, because a plain chart and an
// asteroid chart do not scale together across CPUs.
//
// So assert the STRUCTURE instead. "How far does the integration run" is the
// defect itself, is hardware-independent, and cannot be satisfied by a slow
// runner or defeated by a fast one.
const MAX_SPAN_YEARS = 11;   // seeds every 20 years => at most ~10, plus slack

test('seeds cover many epochs, not just J2000', () => {
  for (const body of SMALL_BODIES) {
    const epochs = Object.keys((seeds as Record<string, Record<string, unknown>>)[body]);
    expect(epochs.length).toBeGreaterThanOrEqual(10);
  }
});

test('no integration ever runs more than a decade from its seed', () => {
  // Sample every year in range, including the ones farthest from any epoch.
  for (const body of SMALL_BODIES) {
    for (let year = 1900; year <= 2100; year++) {
      const span = integrationSpanYears(body, new Date(Date.UTC(year, 5, 15)));
      expect(span).toBeLessThan(MAX_SPAN_YEARS);
    }
  }
});

// One very loose wall-clock backstop, set far above anything a real machine
// produces (measured ~450 ms locally, ~1 s on a CI runner). This catches a
// pathological regression without being sensitive to hardware.
const ABSURDLY_SLOW_MS = 15000;

test('a full chart with every option enabled is not pathologically slow', () => {
  const t = Bun.nanoseconds();
  computeChart({
    solarDate: { year: 1911, month: 6, day: 15 }, clockTime: { hour: 20, minute: 0 },
    longitude: -118.24, latitude: 34.05, timezone: 'America/Los_Angeles',
    asteroids: true, minorAspects: true, declinationAspects: true,
  } as never);
  expect((Bun.nanoseconds() - t) / 1e6).toBeLessThan(ABSURDLY_SLOW_MS);
});
