import { expect, test } from 'bun:test';
import { computeChart } from '../src/core/chart';

// These tests guard the project's central promise: when the birth time is not
// known, say so. They are written to FAIL if the implementation ever quietly
// fills in a default time -- the single most likely way this promise gets lost,
// because a silent noon default produces output that looks completely normal.

const base = { solarDate: { year: 1990, month: 6, day: 15 }, place: 'Los Angeles, CA' } as const;

test('mode A (exact time) does not degrade -- the three headline signs are present', () => {
  const c = computeChart({ ...base, clockTime: { hour: 20, minute: 0 } } as never);
  expect(c.diagnostics.timePrecision).toBe('exact');
  expect(c.highlights.sunSign).toBe('双子');
  expect(c.highlights.moonSign).toBe('双鱼');
  expect(c.highlights.ascendantSign).toBe('射手');
  expect(c.houses).toBeDefined();
  expect(c.partOfFortune).toBeDefined();
});

test('mode C: house-dependent fields are ABSENT, not null', () => {
  const c = computeChart({ ...base } as never);
  expect(c.diagnostics.timePrecision).toBe('date_only');
  expect('angles' in c).toBe(false);
  expect('houses' in c).toBe(false);
  expect('house' in c.positions[0]).toBe(false);
});

test('mode C: partOfFortune must be absent -- the easiest one to forget', () => {
  // It is neither "an angle" nor "a house", but its day/night test and its
  // starting point both depend on the Ascendant.
  const c = computeChart({ ...base } as never);
  expect('partOfFortune' in c).toBe(false);
  expect(c.diagnostics.omitted.map((o: { field: string }) => o.field)).toContain('partOfFortune');
});

test('CORE GUARD: no silent noon default anywhere in the output', () => {
  const c = computeChart({ ...base } as never);
  // If the implementation quietly used 12:00, an Ascendant would exist and would
  // land in some definite sign -- looking perfectly normal to a caller.
  expect('ascendantSign' in c.highlights).toBe(false);
  const json = JSON.stringify(c);
  expect(json).not.toContain('"hour":12');
  expect(json).not.toMatch(/T12:00/);
});

test('mode C: every omitted field states WHY it was omitted', () => {
  const c = computeChart({ ...base } as never);
  expect(c.diagnostics.omitted.length).toBeGreaterThan(0);
  for (const o of c.diagnostics.omitted) {
    expect(typeof o.field).toBe('string');
    expect(o.reason.length).toBeGreaterThan(10);
  }
});

test('mode C: on a cusp day the Sun gets TWO candidates, never a coin flip', () => {
  // 2026-06-21: the Sun leaves Gemini for Cancer during the day. Without a birth
  // time the sun sign is genuinely unknown -- roughly twelve days a year.
  const c = computeChart({ solarDate: { year: 2026, month: 6, day: 21 }, place: 'Beijing' } as never);
  expect(c.highlights.sunSignCandidates).toEqual(['双子', '巨蟹']);
  expect('sunSign' in c.highlights).toBe(false);
});

test('mode C: on an ordinary day the Sun is a single definite sign', () => {
  const c = computeChart({ ...base } as never);
  expect(c.highlights.sunSign).toBe('双子');
  expect('sunSignCandidates' in c.highlights).toBe(false);
});

test('mode C: the Moon spans a range across the day', () => {
  const c = computeChart({ ...base } as never);
  const moon = c.positions.find((p: { body: string }) => p.body === '月亮');
  expect(moon.degreeRange).toBeDefined();
  expect(moon.degreeRange).toHaveLength(2);
});

test('mode B: within the polar circle uses bisection and returns Asc candidates', () => {
  const c = computeChart({
    ...base, clockTimeRange: { from: { hour: 20, minute: 0 }, to: { hour: 23, minute: 59 } },
  } as never);
  expect(c.diagnostics.timePrecision).toBe('range');
  expect(c.diagnostics.method).toBe('bisect');
  expect(c.highlights.ascendantSignCandidates.length).toBeGreaterThan(0);
  const first = c.highlights.ascendantSignCandidates[0];
  expect(first).toHaveProperty('sign');
  expect(first).toHaveProperty('from');
  expect(first).toHaveProperty('to');
});

test('mode B: beyond the polar circle switches to scanning and says so', () => {
  // Above 66 deg the Ascendant is not monotonic (measured: 132 reversals per day
  // at 70 deg), so bisection would silently return wrong candidates.
  const c = computeChart({
    solarDate: { year: 1990, month: 6, day: 15 },
    longitude: 18.96, latitude: 69.65, timezone: 'Europe/Oslo',
    clockTimeRange: { from: { hour: 20, minute: 0 }, to: { hour: 23, minute: 59 } },
  } as never);
  expect(c.diagnostics.method).toBe('scan');
  expect(c.diagnostics.ascendantMonotonic).toBe(false);
});

test('mode B: a window crossing midnight is accepted', () => {
  const c = computeChart({
    ...base, clockTimeRange: { from: { hour: 22, minute: 0 }, to: { hour: 2, minute: 0 } },
  } as never);
  expect(c.diagnostics.timePrecision).toBe('range');
  expect(c.diagnostics.range.crossesMidnight).toBe(true);
});

test('modes B and C never claim an applying/separating aspect', () => {
  for (const input of [
    { ...base },
    { ...base, clockTimeRange: { from: { hour: 20, minute: 0 }, to: { hour: 23, minute: 59 } } },
  ]) {
    const c = computeChart(input as never);
    for (const a of c.aspects) expect('applying' in a).toBe(false);
  }
});

test('mode C aspects hold at BOTH ends of the day, with an orb range', () => {
  const c = computeChart({ ...base } as never);
  for (const a of c.aspects) {
    expect(a.orbRange).toHaveLength(2);
    expect('orb' in a).toBe(false);
  }
});
