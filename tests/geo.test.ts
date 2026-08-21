import { expect, test } from 'bun:test';
import { lookupCity } from '../src/geo/resolver';

// Tolerance is 0.3 deg: the city-timezones DB stores a municipal centroid, not the
// landmark coordinate people quote. 0.3 deg of latitude shifts the Ascendant by well
// under a degree at mid-latitudes, which is inside the noise of a `place` lookup --
// callers wanting exactness pass explicit longitude/latitude instead.
const NEAR = 0.3;

test('city lookup returns latitude -- required for charts, absent in ziwei/bazi', () => {
  const [la] = lookupCity('Los Angeles');
  expect(Math.abs(la.latitude - 34.05)).toBeLessThan(NEAR);
  expect(Math.abs(la.longitude - -118.24)).toBeLessThan(NEAR);
  expect(la.timezone).toBe('America/Los_Angeles');
});

test('Chinese cities resolve to the single nationwide civil zone', () => {
  const [bj] = lookupCity('Beijing');
  expect(bj.timezone).toBe('Asia/Shanghai');
  expect(Math.abs(bj.latitude - 39.90)).toBeLessThan(NEAR);
});

test('southern-hemisphere cities carry a negative latitude', () => {
  const [syd] = lookupCity('Sydney');
  expect(syd.latitude).toBeLessThan(0);
  expect(Math.abs(syd.latitude - -33.87)).toBeLessThan(NEAR);
});

test('above the Arctic Circle resolves (polar handling is exercised downstream)', () => {
  const [tromso] = lookupCity('Tromso');
  expect(tromso.latitude).toBeGreaterThan(66.56);
  // NOT a bug: since tzdata 2022b the IANA project merged Europe/Oslo, /Stockholm and
  // /Copenhagen into links pointing at Europe/Berlin (identical CET/CEST rules since
  // 1970). geo-tz returns the canonical zone. Do not "fix" this to Europe/Oslo --
  // both names resolve to the same offsets, and Berlin is the canonical one.
  expect(['Europe/Berlin', 'Europe/Oslo']).toContain(tromso.timezone);
});

test('unknown city yields no match rather than a wrong one', () => {
  expect(lookupCity('Nowherecityxyz')).toHaveLength(0);
});
