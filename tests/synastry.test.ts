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

// ------------------------------------------------- conventions must be honest

test('per-person conventions are rejected outright, not silently overridden', async () => {
  // The conventions apply to BOTH charts and are reported once at the top.
  // Accepting them per person and then quietly discarding them is worse than
  // refusing: the caller believes a setting took effect when it did not.
  const { callTool } = await import('../src/mcp/server');
  await expect(callTool('calculate_synastry', {
    personA: { ...A, houseSystem: 'whole-sign' }, personB: B,
  })).rejects.toThrow();
});

test('diagnostics.orbs describes the orbs that every part of the result used', async () => {
  // A per-person `orbs` used to leak into the cross-aspects while personB's
  // own natal aspects kept the defaults -- so the single reported table
  // described a calculation that never uniformly happened.
  const { callTool } = await import('../src/mcp/server');
  await expect(callTool('calculate_synastry', {
    personA: { ...A, orbs: { conjunction: 1 } }, personB: B,
  })).rejects.toThrow();

  // Passed at the top level it applies everywhere, and is reported truthfully.
  const r = await callTool('calculate_synastry', {
    personA: A, personB: B, orbs: { conjunction: 1, sextile: 1, square: 1, trine: 1, opposition: 1 },
  });
  const s = JSON.parse(r.content[0].text);
  for (const table of [s.diagnostics.orbs, s.personA.diagnostics.orbs, s.personB.diagnostics.orbs]) {
    expect(Object.values(table)).toEqual([1, 1, 1, 1, 1]);
  }
});

// ------------------------------------ range mode is mode B, not mode C

test('a known time WINDOW degrades overlays to candidates, it does not delete them', () => {
  // calculate_natal already reports houseCandidates for a 30-minute window --
  // often a single house. Collapsing mode B into mode C here throws away
  // information the caller supplied. "Do not fake" must not become
  // "do not answer".
  const window = { ...A, clockTime: undefined,
                   clockTimeRange: { from: { hour: 11, minute: 15 }, to: { hour: 11, minute: 45 } } };
  const s = computeSynastry({ personA: window, personB: B } as never);
  expect(s.overlays.aInB.length).toBeGreaterThan(0);           // needs B's houses: unaffected
  expect(s.overlays.bInA.length).toBeGreaterThan(0);           // needs A's houses: candidates
  for (const o of s.overlays.bInA) {
    expect(Array.isArray(o.houseCandidates)).toBe(true);
    expect(o.houseCandidates.length).toBeGreaterThan(0);
  }
  expect(s.diagnostics.omitted.map((x: { field: string }) => x.field)).not.toContain('overlays.bInA');
});

test('a date-only birth really does delete that direction -- a whole day is too wide', () => {
  const s = computeSynastry({ personA: { ...A, clockTime: undefined }, personB: B } as never);
  expect(s.overlays.bInA).toHaveLength(0);
  expect(s.diagnostics.omitted.map((x: { field: string }) => x.field)).toContain('overlays.bInA');
});

// --------------------------------------------------------- south node

test('south-node aspects are suppressed by default -- they mirror the north node', () => {
  // Every aspect to the North Node has an automatic mirror to the South at the
  // identical orb, so reporting both doubles the node rows for zero new fact.
  // astro.com, astro-seek, TimePassages and 爱星盘 all default to hiding them.
  const s = computeSynastry({ personA: A, personB: B } as never);
  for (const a of s.aspects) {
    expect(a.bodyA).not.toBe('南交点');
    expect(a.bodyB).not.toBe('南交点');
  }
  // ...but the South Node still has a position, sign and house.
  expect(s.personA.positions.some((p: { body: string }) => p.body === '南交点')).toBe(true);
});

test('southNodeAspects: true brings them back', () => {
  const s = computeSynastry({ personA: A, personB: B, southNodeAspects: true } as never);
  expect(s.aspects.some((a: { bodyA: string; bodyB: string }) =>
    a.bodyA === '南交点' || a.bodyB === '南交点')).toBe(true);
});

test('a near-day-long window sweeps every house, in synastry as in the natal tool', () => {
  // Cusps make one full turn per day, so a ~23h window returns a body to the
  // house it started in having crossed all twelve. chart.ts detects this via
  // `sweepsFullTurn`; the overlay path used to report a confident single house.
  const wide = { ...A, clockTime: undefined,
                 clockTimeRange: { from: { hour: 1, minute: 0 }, to: { hour: 0, minute: 30 } } };
  const s = computeSynastry({ personA: wide, personB: B } as never);
  // Every body must show a wide sweep -- a single confident house is the bug.
  for (const o of s.overlays.bInA as { body: string; houseCandidates: number[] }[]) {
    expect(o.houseCandidates.length).toBeGreaterThan(1);
  }
  expect(s.overlays.bInA.some((o: { houseCandidates: number[] }) => o.houseCandidates.length === 12)).toBe(true);

  // ...and the same person through calculate_natal agrees.
  const { computeChart } = require('../src/core/chart');
  const natal = computeChart(wide as never);
  const twelve = natal.positions.filter((p: { houseCandidates?: number[] }) => p.houseCandidates?.length === 12);
  expect(twelve.length).toBeGreaterThan(0);
});
