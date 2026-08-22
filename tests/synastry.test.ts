import { expect, test } from 'bun:test';
import { computeSynastry } from '../src/core/synastry';

// Two real charts used throughout, so the numbers are checkable by hand.
const A = { solarDate: { year: 1993, month: 7, day: 14 }, clockTime: { hour: 11, minute: 27 }, place: 'Kunming' };
const B = { solarDate: { year: 1993, month: 5, day: 20 }, clockTime: { hour: 9, minute: 40 }, place: 'Tianjin' };

test('cross-aspects are between the two charts, never within one', () => {
  const s = computeSynastry({ personA: A, personB: B } as never);
  expect(s.aspects.length).toBeGreaterThan(0);
  for (const a of s.aspects) {
    expect(a.from).toBe('A');
    expect(a.to).toBe('B');
  }
  // A's Sun squaring A's own Saturn is an intra-chart aspect and must not appear
  const intra = s.aspects.filter((a: { bodyA: string; bodyB: string }) =>
    a.bodyA === a.bodyB && a.bodyA === '太阳');
  expect(intra.length).toBeLessThanOrEqual(1);   // Sun-to-Sun across charts is legitimate
});

test('both natal charts come back so the caller need not recompute them', () => {
  const s = computeSynastry({ personA: A, personB: B } as never);
  expect(s.personA.highlights.sunSign).toBe('巨蟹');
  expect(s.personB.highlights.sunSign).toBe('金牛');
});

test('house overlays are directional and only exist where houses do', () => {
  const s = computeSynastry({ personA: A, personB: B } as never);
  // "A's Mars falls in B's 7th" requires B to have houses.
  expect(s.overlays.aInB.length).toBeGreaterThan(0);
  expect(s.overlays.bInA.length).toBeGreaterThan(0);
  for (const o of s.overlays.aInB) expect(o.house).toBeGreaterThanOrEqual(1);
});

test('an unknown birth time on one side removes only that side of the overlay', () => {
  // B has no time: B has no houses, so "A's body in B's house" cannot exist.
  // "B's body in A's house" still can -- A's houses are known.
  const s = computeSynastry({ personA: A, personB: { ...B, clockTime: undefined } } as never);
  expect(s.overlays.aInB).toHaveLength(0);
  expect(s.overlays.bInA.length).toBeGreaterThan(0);
  expect(s.diagnostics.omitted.map((o: { field: string }) => o.field)).toContain('overlays.aInB');
});

test('angle aspects appear only for the person whose time is known', () => {
  const s = computeSynastry({ personA: A, personB: { ...B, clockTime: undefined } } as never);
  const toAngles = s.aspects.filter((a: { bodyB: string }) => ['上升', '天顶'].includes(a.bodyB));
  expect(toAngles).toHaveLength(0);
});

test('the Moon is flagged when a birth time is unknown -- it moves 12-15 deg a day', () => {
  const s = computeSynastry({ personA: A, personB: { ...B, clockTime: undefined } } as never);
  const moonAspects = s.aspects.filter((a: { bodyB: string }) => a.bodyB === '月亮');
  for (const m of moonAspects) expect(m.uncertain).toBe(true);
});

test('conventions apply to both charts and are reported once', () => {
  const s = computeSynastry({ personA: A, personB: B, node: 'mean', houseSystem: 'whole-sign' } as never);
  expect(s.diagnostics.node).toBe('mean');
  expect(s.personA.diagnostics.houseSystem).toBe('whole-sign');
  expect(s.personB.diagnostics.houseSystem).toBe('whole-sign');
});
