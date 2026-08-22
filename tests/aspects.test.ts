import { expect, test } from 'bun:test';
import { computeAspects } from '../src/core/aspects';
import { dignityOf } from '../src/core/dignity';

const P = (body: string, lon: number, dec = 0, speed = 1) => ({ body, lon, dec, speed });

test('only the five major aspects fire by default', () => {
  expect(computeAspects([P('Sun', 0), P('Moon', 0.5)], {})[0].aspect).toBe('合');
  expect(computeAspects([P('Sun', 0), P('Moon', 60)], {})[0].aspect).toBe('六合');
  expect(computeAspects([P('Sun', 0), P('Moon', 90)], {})[0].aspect).toBe('刑');
  expect(computeAspects([P('Sun', 0), P('Moon', 120)], {})[0].aspect).toBe('拱');
  expect(computeAspects([P('Sun', 0), P('Moon', 180)], {})[0].aspect).toBe('冲');
  // 30 deg is a MINOR aspect and must not appear by default
  expect(computeAspects([P('Sun', 0), P('Moon', 30)], {})).toHaveLength(0);
});

test('minor aspects require an explicit opt-in', () => {
  const a = computeAspects([P('Sun', 0), P('Moon', 30)], { minorAspects: true });
  expect(a).toHaveLength(1);
  expect(a[0].aspect).toBe('半六合');
});

test('orbs follow the aspect type -- the modern convention, not classical moiety', () => {
  // conjunction orb 8: 7.5 apart is in, 8.5 apart is out
  expect(computeAspects([P('Sun', 0), P('Moon', 7.5)], {})).toHaveLength(1);
  expect(computeAspects([P('Sun', 0), P('Moon', 8.5)], {})).toHaveLength(0);
  // sextile orb 6: 6.5 apart from exact is out
  expect(computeAspects([P('Sun', 0), P('Moon', 66.5)], {})).toHaveLength(0);
});

test('REGRESSION (auseklis A5): declination aspects are OFF by default', () => {
  // auseklis emitted "North Node Parallel South Node, orb 0" on every single chart
  // because both declinations were hard-coded to zero.
  const a = computeAspects([P('NorthNode', 10, 0), P('SouthNode', 190, 0)], {});
  expect(a.some((x) => x.aspect === '平行' || x.aspect === '反平行')).toBe(false);
});

test('REGRESSION (auseklis A5): enabled declination aspects use REAL declinations', () => {
  // Genuinely different declinations must not be called parallel.
  const far = computeAspects([P('Moon', 10, 20.5), P('Pluto', 100, -3.2)], { declinationAspects: true });
  expect(far.some((x) => x.aspect === '平行')).toBe(false);
  // Genuinely close ones must be.
  const near = computeAspects([P('Moon', 10, 20.5), P('Venus', 100, 20.9)], { declinationAspects: true });
  expect(near.some((x) => x.aspect === '平行')).toBe(true);
  // Equal and opposite is CONTRAparallel, not parallel.
  const opp = computeAspects([P('Moon', 10, 20.5), P('Venus', 100, -20.6)], { declinationAspects: true });
  expect(opp.some((x) => x.aspect === '反平行')).toBe(true);
  expect(opp.some((x) => x.aspect === '平行')).toBe(false);
});

test('applying vs separating is decided by relative speed', () => {
  // Moon at 85 deg closing on a square to a Sun at 0: faster body approaching exactness
  const [sq] = computeAspects([P('Sun', 0, 0, 0.95), P('Moon', 85, 0, 13.2)], {});
  expect(sq.aspect).toBe('刑');
  expect(sq.applying).toBe(true);
  // past exactness and pulling away
  const [sep] = computeAspects([P('Sun', 0, 0, 0.95), P('Moon', 95, 0, 13.2)], {});
  expect(sep.applying).toBe(false);
});

test('a body never aspects itself and pairs are not double-counted', () => {
  const a = computeAspects([P('Sun', 0), P('Moon', 90), P('Mars', 180)], {});
  for (const x of a) expect(x.body1).not.toBe(x.body2);
  const keys = a.map((x) => [x.body1, x.body2].sort().join('-') + x.aspect);
  expect(new Set(keys).size).toBe(keys.length);
});

test('essential dignity: the four classical states resolve correctly', () => {
  expect(dignityOf('Mars', 5).kind).toBe('庙');       // Aries
  expect(dignityOf('Mars', 185).kind).toBe('陷');     // Libra
  expect(dignityOf('Sun', 130).kind).toBe('庙');      // Leo
  expect(dignityOf('Sun', 10).kind).toBe('旺');       // Aries
  expect(dignityOf('Sun', 190).kind).toBe('落');      // Libra
  expect(dignityOf('Mercury', 100).kind).toBeNull();  // Cancer -- no dignity
});

test('outer-planet rulerships are flagged as a modern addition, not consensus', () => {
  expect(dignityOf('Pluto', 220).modern).toBe(true);    // Scorpio, modern rulership
  expect(dignityOf('Uranus', 310).modern).toBe(true);   // Aquarius
  expect(dignityOf('Neptune', 340).modern).toBe(true);  // Pisces
  expect(dignityOf('Mars', 5).modern).toBe(false);      // classical, undisputed
});

// ---------------------------------------------------------- aspect naming

test('the 45 and 135 degree aspects carry their correct Chinese names', () => {
  // 45 deg is 八分相 (semi-square, also 半刑); 八分之三相位 is the name for
  // 135 deg (sesquiquadrate). The table originally attached the 135 deg name
  // to the 45 deg angle and omitted 135 deg entirely.
  const at = (sep: number) =>
    computeAspects([P('Sun', 0), P('Moon', sep)], { minorAspects: true })[0]?.aspect;
  expect(at(45)).toBe('八分相');
  expect(at(135)).toBe('补八分相');
  expect(at(30)).toBe('半六合');
  expect(at(72)).toBe('五分相');
  expect(at(150)).toBe('补十二');
});

// ------------------------------------------------------------ orb overrides

test('orbs can be overridden per aspect with language-independent keys', () => {
  // Orbs are the single most school-dependent number in the whole chart, so
  // they must be a parameter rather than a constant. Keys are English so the
  // API does not change shape with `lang`.
  const wide = computeAspects([P('Sun', 0), P('Moon', 9)], { orbs: { conjunction: 10 } });
  expect(wide[0].aspect).toBe('合');
  expect(computeAspects([P('Sun', 0), P('Moon', 9)], {})).toHaveLength(0);

  const narrow = computeAspects([P('Sun', 0), P('Moon', 5)], { orbs: { conjunction: 3 } });
  expect(narrow).toHaveLength(0);
});

test('an orb override touches only the aspect it names', () => {
  const opts = { orbs: { conjunction: 2 } };
  expect(computeAspects([P('Sun', 0), P('Moon', 5)], opts)).toHaveLength(0);      // conjunction narrowed
  expect(computeAspects([P('Sun', 0), P('Moon', 186)], opts)[0].aspect).toBe('冲'); // opposition untouched
});

test('unknown orb keys are rejected rather than silently ignored', () => {
  // A typo like { conjuction: 10 } must not quietly leave the default in place;
  // the caller would believe a convention was applied when it was not.
  expect(() => computeAspects([P('Sun', 0), P('Moon', 5)], { orbs: { conjuction: 10 } as never }))
    .toThrow(/unknown aspect|conjuction/i);
});
