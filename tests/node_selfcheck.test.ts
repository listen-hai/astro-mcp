import { expect, test } from 'bun:test';
import * as AstronomyImport from 'astronomy-engine';
import { nodeLongitude, lilith, pointPosition } from '../src/ephemeris/points';
import { norm360 } from '../src/ephemeris/frames';

const A = ((AstronomyImport as never as { default?: typeof AstronomyImport }).default
  ?? AstronomyImport) as typeof AstronomyImport;

test('self-check: at a node crossing the Moon sits exactly on the true node', () => {
  // The strongest available ground truth without a second ephemeris: astronomy-engine
  // finds node-crossing instants independently of how we compute the node longitude.
  // Computing the node in the J2000 frame instead of ecliptic-of-date makes this fail
  // by ~1350 arcsec. See spec 7.1.
  let ev = A.SearchMoonNode(new Date('2026-01-01T00:00:00Z'));
  for (let i = 0; i < 8; i++) {
    const moonLon = norm360(A.EclipticGeoMoon(ev.time).lon);
    const n = nodeLongitude(ev.time.date, 'true');
    const expected = ev.kind === 1 ? n : norm360(n + 180);
    let d = Math.abs(moonLon - expected) % 360;
    d = Math.min(d, 360 - d);
    expect(d * 3600).toBeLessThan(1);
    ev = A.NextMoonNode(ev);
  }
});

const delta = (a: number, b: number) => {
  let v = b - a;
  if (v > 180) v -= 360;
  if (v < -180) v += 360;
  return v;
};

test('true node goes direct part of the year; mean node never does', () => {
  let trueDirect = 0;
  let meanDirect = 0;
  for (let i = 0; i < 365; i++) {
    const d0 = new Date(Date.UTC(2026, 0, 1 + i));
    const d1 = new Date(Date.UTC(2026, 0, 2 + i));
    if (delta(nodeLongitude(d0, 'true'), nodeLongitude(d1, 'true')) > 0) trueDirect++;
    if (delta(nodeLongitude(d0, 'mean'), nodeLongitude(d1, 'mean')) > 0) meanDirect++;
  }
  expect(trueDirect).toBeGreaterThan(50);
  expect(meanDirect).toBe(0);
});

test('true and mean node stay within ~2 deg of each other', () => {
  let worst = 0;
  for (let i = 0; i < 365; i += 7) {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    let g = Math.abs(nodeLongitude(d, 'true') - nodeLongitude(d, 'mean')) % 360;
    g = Math.min(g, 360 - g);
    worst = Math.max(worst, g);
  }
  expect(worst).toBeGreaterThan(1);    // they really do differ -- not the same function
  expect(worst).toBeLessThan(2.5);
});

test('REGRESSION (auseklis A4): node declination is never hard-coded to zero', () => {
  const decs = [0, 45, 90, 135, 180].map((i) =>
    pointPosition('NorthNode', new Date(Date.UTC(2026, 0, 1 + i)), { node: 'true' }).dec);
  expect(Math.max(...decs.map(Math.abs))).toBeGreaterThan(5);
  expect(new Set(decs.map((d) => d.toFixed(3))).size).toBeGreaterThan(1);
});

test('node ecliptic latitude IS zero -- by definition, and stays that way', () => {
  // Unlike declination this one legitimately is zero: the nodes lie on the ecliptic.
  const p = pointPosition('NorthNode', new Date('2026-08-20T00:00:00Z'), { node: 'true' });
  expect(Math.abs(p.lat)).toBeLessThan(1e-9);
});

test('north and south node are exactly 180 deg apart', () => {
  const d = new Date('2026-08-20T00:00:00Z');
  const n = pointPosition('NorthNode', d, { node: 'true' }).lon;
  const s = pointPosition('SouthNode', d, { node: 'true' }).lon;
  expect(norm360(s - n)).toBeCloseTo(180, 6);
});

test('REGRESSION (auseklis A4): true lilith carries a real ecliptic latitude', () => {
  const lats = [0, 60, 120].map((i) => lilith(new Date(Date.UTC(2026, 0, 1 + i)), 'true').lat);
  expect(Math.max(...lats.map(Math.abs))).toBeGreaterThan(0.5);
});

test('mean lilith latitude is zero BY CONVENTION, and both kinds differ in longitude', () => {
  const d = new Date('2026-08-20T00:00:00Z');
  expect(Math.abs(lilith(d, 'mean').lat)).toBeLessThan(1e-9);
  let g = Math.abs(lilith(d, 'mean').lon - lilith(d, 'true').lon) % 360;
  g = Math.min(g, 360 - g);
  expect(g).toBeGreaterThan(0.1);   // the two conventions are genuinely different
});
