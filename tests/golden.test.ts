import { expect, test } from 'bun:test';
import { computeChart } from '../src/core/chart';

// One fully worked chart, cross-checked against JPL Horizons for the bodies and
// against an independent implementation for the angles.
const LA_1990 = {
  solarDate: { year: 1990, month: 6, day: 15 },
  clockTime: { hour: 20, minute: 0 },
  place: 'Los Angeles, CA',
} as const;

test('golden chart: bodies land in the expected signs', () => {
  const c = computeChart({ ...LA_1990 } as never);
  const by = Object.fromEntries(c.positions.map((p: { body: string; sign: string }) => [p.body, p.sign]));
  expect(by['太阳']).toBe('双子');
  expect(by['月亮']).toBe('双鱼');
  expect(by['水星']).toBe('双子');
  expect(by['金星']).toBe('金牛');
  expect(by['火星']).toBe('白羊');
  expect(by['木星']).toBe('巨蟹');
  expect(by['土星']).toBe('摩羯');
  expect(by['冥王星']).toBe('天蝎');
});

test('golden chart: retrograde flags match the real sky', () => {
  const c = computeChart({ ...LA_1990 } as never);
  const retro = Object.fromEntries(
    c.positions.map((p: { body: string; retrograde: boolean }) => [p.body, p.retrograde]));
  expect(retro['土星']).toBe(true);
  expect(retro['天王星']).toBe(true);
  expect(retro['海王星']).toBe(true);
  expect(retro['冥王星']).toBe(true);
  expect(retro['太阳']).toBe(false);
  expect(retro['月亮']).toBe(false);
});

test('golden chart: Placidus is the default and Asc/MC sit on cusps 1 and 10', () => {
  const c = computeChart({ ...LA_1990 } as never);
  expect(c.houses.system).toBe('placidus');
  expect(c.houses.cusps[0]).toBeCloseTo(c.angles.ascendant.longitude, 6);
  expect(c.houses.cusps[9]).toBeCloseTo(c.angles.midheaven.longitude, 6);
});

test('spec 5: switching to whole-sign moves most planets to a different house', () => {
  // Measured: 9 of 10 planets change house on this chart. This is a conventions
  // difference, not an accuracy one -- and the reason Placidus is the default.
  const p = computeChart({ ...LA_1990 } as never);
  const w = computeChart({ ...LA_1990, houseSystem: 'whole-sign' } as never);
  const houseOf = (c: never, body: string) =>
    (c as { positions: { body: string; house: number }[] }).positions.find((x) => x.body === body)!.house;
  const moved = ['月亮', '水星', '金星', '火星', '木星', '土星', '天王星', '海王星', '冥王星']
    .filter((b) => houseOf(p as never, b) !== houseOf(w as never, b));
  expect(moved.length).toBeGreaterThanOrEqual(8);
});

test('Chiron is on by default; the four asteroids are not', () => {
  const c = computeChart({ ...LA_1990 } as never);
  const bodies = c.positions.map((p: { body: string }) => p.body);
  expect(bodies).toContain('凯龙');
  expect(bodies).not.toContain('谷神');
  expect(c.diagnostics.included).toContain('chiron');
});

test('asteroids appear only when asked for', () => {
  const c = computeChart({ ...LA_1990, asteroids: true } as never);
  const bodies = c.positions.map((p: { body: string }) => p.body);
  for (const a of ['谷神', '智神', '婚神', '灶神']) expect(bodies).toContain(a);
});

test('diagnostics always records which conventions produced this chart', () => {
  const c = computeChart({ ...LA_1990 } as never);
  expect(c.diagnostics.houseSystem).toBe('placidus');
  expect(c.diagnostics.zodiac).toBe('tropical');
  expect(c.diagnostics.node).toBe('true');
  expect(c.diagnostics.lilith).toBe('mean');
  expect(c.diagnostics.ephemeris).toContain('astronomy-engine');
  expect(c.diagnostics.orbs).toBeDefined();
});

test('sidereal longitudes equal tropical minus the ayanamsa', () => {
  const trop = computeChart({ ...LA_1990 } as never);
  const side = computeChart({ ...LA_1990, zodiac: 'sidereal-lahiri' } as never);
  const t0 = trop.positions[0].longitude;
  const s0 = side.positions[0].longitude;
  expect(((t0 - s0) % 360 + 360) % 360).toBeCloseTo(side.diagnostics.ayanamsa, 3);
});
