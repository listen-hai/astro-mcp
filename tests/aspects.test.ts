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
