import { expect, test } from 'bun:test';
import { computeAngles } from '../src/ephemeris/angles';
import { computeHouses } from '../src/ephemeris/vendor/houses';
import { ayanamsa } from '../src/ephemeris/vendor/sidereal';
import { norm360, obliquity } from '../src/ephemeris/frames';
import * as AstronomyImport from 'astronomy-engine';

const A = ((AstronomyImport as never as { default?: typeof AstronomyImport }).default
  ?? AstronomyImport) as typeof AstronomyImport;

const D = new Date('1990-06-16T03:00:00Z');   // 1990-06-15 20:00 America/Los_Angeles
const LA = { latitude: 34.0522, longitude: -118.2437 };
const EPS = obliquity(A.MakeTime(D));

test('golden angles: Los Angeles 1990-06-15 20:00 -> Asc Sag 24d26m, MC Lib 11d50m', () => {
  const { ascendant, midheaven } = computeAngles(D, LA);
  expect(Math.abs(ascendant - 264.433)).toBeLessThan(0.1);
  expect(Math.abs(midheaven - 191.833)).toBeLessThan(0.1);
});

test('the twelve cusps cover exactly 360 deg and advance monotonically', () => {
  for (const latitude of [-33.87, -20, 0, 34.05, 51.5, 60]) {
    const loc = { latitude, longitude: 0 };
    const { ascendant, midheaven } = computeAngles(D, loc);
    for (const system of ['placidus', 'whole-sign', 'equal', 'porphyry'] as const) {
      const { cusps } = computeHouses(system, ascendant, midheaven, loc, EPS);
      expect(cusps).toHaveLength(12);
      const widths = cusps.map((c, i) => norm360(cusps[(i + 1) % 12] - c));
      expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(360, 6);
      for (const w of widths) expect(w).toBeGreaterThan(0);
    }
  }
});

test('Placidus puts Asc on cusp 1 and MC on cusp 10; whole-sign does not', () => {
  const { ascendant, midheaven } = computeAngles(D, LA);
  const p = computeHouses('placidus', ascendant, midheaven, LA, EPS);
  expect(p.cusps[0]).toBeCloseTo(ascendant, 6);
  expect(p.cusps[9]).toBeCloseTo(midheaven, 6);

  const w = computeHouses('whole-sign', ascendant, midheaven, LA, EPS);
  expect(w.cusps[0] % 30).toBeCloseTo(0, 6);      // whole signs start at 0 deg
  expect(Math.abs(w.cusps[9] - midheaven)).toBeGreaterThan(1);
});

test('above the polar circle Placidus falls back and MUST leave a trace', () => {
  const loc = { latitude: 69.65, longitude: 18.96 };
  const { ascendant, midheaven } = computeAngles(D, loc);
  const h = computeHouses('placidus', ascendant, midheaven, loc, EPS);
  expect(h.note).toBeDefined();
  expect(h.note!.toLowerCase()).toContain('porphyry');
});

test('whole-sign works at any latitude, including inside the polar circle', () => {
  const loc = { latitude: 78, longitude: 15 };
  const { ascendant, midheaven } = computeAngles(D, loc);
  const h = computeHouses('whole-sign', ascendant, midheaven, loc, EPS);
  expect(h.cusps).toHaveLength(12);
  expect(h.note).toBeUndefined();
});

test('spec 5.2: the Ascendant stays on the eastern half from the MC', () => {
  // A naked atan2 returns the DESCENDANT for part of the day above the polar
  // circle. With the east-horizon convention applied, Asc-MC must stay in (0,180).
  for (const latitude of [34.05, 51.5, 70, 78]) {
    for (let h = 0; h < 24; h += 2) {
      const d = new Date(Date.UTC(2026, 5, 15, h));
      const { ascendant, midheaven, degenerate } = computeAngles(d, { latitude, longitude: 0 });
      if (degenerate) continue;
      const sep = norm360(ascendant - midheaven);
      expect(sep).toBeGreaterThan(0);
      expect(sep).toBeLessThan(180);
    }
  }
});

test('spec 4.3: Ascendant is monotonic at |lat| <= 66 and not beyond', () => {
  const reversals = (latitude: number) => {
    let prev: number | null = null;
    let back = 0;
    for (let m = 0; m < 1440; m += 2) {
      const a = computeAngles(new Date(Date.UTC(2026, 5, 15, 0, m)), { latitude, longitude: 0 }).ascendant;
      if (prev !== null) {
        let df = norm360(a - prev);
        if (df > 180) df -= 360;
        if (df < 0) back++;
      }
      prev = a;
    }
    return back;
  };
  expect(reversals(51.5)).toBe(0);
  expect(reversals(66)).toBe(0);        // bisection is safe here
  expect(reversals(70)).toBeGreaterThan(0);   // and NOT safe here
});

test('ayanamsa: zero for tropical, ~23.85 deg for Lahiri at J2000, growing', () => {
  expect(ayanamsa('tropical', new Date())).toBe(0);
  const a2000 = ayanamsa('sidereal-lahiri', new Date('2000-01-01T12:00:00Z'));
  const a2026 = ayanamsa('sidereal-lahiri', new Date('2026-01-01T12:00:00Z'));
  expect(a2000).toBeCloseTo(23.85, 1);
  expect(a2026).toBeGreaterThan(a2000);
  expect((a2026 - a2000) * 3600 / 26).toBeCloseTo(50.3, 0);   // ~50.29"/yr
});
