import { expect, test } from 'bun:test';
import * as AstronomyImport from 'astronomy-engine';
import { eclipticOfDate, eclipticToEquatorial, obliquity, norm360 } from '../src/ephemeris/frames';

const A = ((AstronomyImport as never as { default?: typeof AstronomyImport }).default
  ?? AstronomyImport) as typeof AstronomyImport;

const T = A.MakeTime(new Date('2026-08-20T00:00:00Z'));

test('ecliptic-of-date differs from J2000 ecliptic by the accumulated precession', () => {
  // ~50.29"/yr since J2000; by 2026 that is ~0.37 deg. This test exists so that a
  // future edit swapping in Rotation_EQJ_ECL() fails loudly instead of silently
  // shifting every node and body by a third of a degree. See spec 7.1.
  const v = A.GeoVector(A.Body.Mars, T, true);
  const ect = eclipticOfDate(v, T).lon;
  const j2000 = A.RotateVector(A.Rotation_EQJ_ECL(), v);
  const ecl = norm360(Math.atan2(j2000.y, j2000.x) * 180 / Math.PI);
  let d = Math.abs(ect - ecl) % 360;
  d = Math.min(d, 360 - d);
  expect(d).toBeGreaterThan(0.3);
  expect(d).toBeLessThan(0.45);
});

test('ecliptic-of-date longitude matches astronomy-engine for the Moon', () => {
  const mine = eclipticOfDate(A.GeoVector(A.Body.Moon, T, true), T).lon;
  const theirs = norm360(A.EclipticGeoMoon(T).lon);
  let d = Math.abs(mine - theirs) % 360;
  d = Math.min(d, 360 - d);
  expect(d * 3600).toBeLessThan(30);   // arcseconds; light-time handling differs slightly
});

test('obliquity of date is ~23.44 deg and includes nutation', () => {
  const e = obliquity(T);
  expect(e).toBeGreaterThan(23.4);
  expect(e).toBeLessThan(23.5);
});

test('ecliptic -> equatorial: the solstice point sits at the obliquity', () => {
  const { dec } = eclipticToEquatorial(90, 0, T);
  expect(dec).toBeCloseTo(obliquity(T), 2);
});

test('ecliptic -> equatorial: the equinox point sits on the celestial equator', () => {
  expect(eclipticToEquatorial(0, 0, T).dec).toBeCloseTo(0, 6);
  expect(eclipticToEquatorial(180, 0, T).dec).toBeCloseTo(0, 6);
});

test('ecliptic -> equatorial agrees with astronomy-engine for a real body', () => {
  const eq = A.Equator(A.Body.Mars, T, new A.Observer(0, 0, 0), true, true);
  const { lon, lat } = eclipticOfDate(A.GeoVector(A.Body.Mars, T, true), T);
  const { dec } = eclipticToEquatorial(lon, lat, T);
  expect(Math.abs(dec - eq.dec) * 60).toBeLessThan(1);   // within one arcminute
});

test('norm360 wraps negatives and multiples correctly', () => {
  expect(norm360(-1)).toBeCloseTo(359, 9);
  expect(norm360(361)).toBeCloseTo(1, 9);
  expect(norm360(720)).toBeCloseTo(0, 9);
});
