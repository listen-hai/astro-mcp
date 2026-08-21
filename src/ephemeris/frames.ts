import * as AstronomyImport from 'astronomy-engine';
const A = ((AstronomyImport as unknown as { default?: typeof AstronomyImport }).default ??
  AstronomyImport) as typeof AstronomyImport;

// Use JPL's own Delta-T (TT-UT1) model instead of astronomy-engine's default
// Espenak-Meeus polynomial. They agree closely near J2000 but the default's
// far-future extrapolation drifts enough to push the Moon (~0.5 deg/hour)
// past the 1-arcminute accuracy target at the edges of the 1900-2100 range
// (measured: 1.31' at 2100-01-01 vs 0.02' with this model). This is process-
// wide, global state inside astronomy-engine, so it only needs setting once;
// every module in this project goes through this file first.
A.SetDeltaTFunction(A.DeltaT_JplHorizons);

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const norm360 = (d: number): number => ((d % 360) + 360) % 360;

/**
 * EQJ (J2000 mean equator) -> true ecliptic of date (ECT).
 *
 * MUST NOT be replaced with `Rotation_EQJ_ECL()` (the J2000 ecliptic): that
 * carries the accumulated precession since J2000 -- a measured 1350 arcsec
 * (0.375 deg) systematic offset in 2026, growing every year, large enough to
 * push a lunar node across a zodiac sign boundary with no obvious symptom.
 * See spec 7.1.
 */
export function eqjToEct(t: AstronomyImport.AstroTime): AstronomyImport.RotationMatrix {
  return A.Rotation_EQJ_ECT(t);
}

/** Rotates an EQJ vector into ecliptic-of-date longitude/latitude (degrees). */
export function eclipticOfDate(
  vec: AstronomyImport.Vector,
  t: AstronomyImport.AstroTime
): { lon: number; lat: number } {
  const r = A.RotateVector(eqjToEct(t), vec);
  const lon = norm360(Math.atan2(r.y, r.x) * R2D);
  const lat = Math.atan2(r.z, Math.hypot(r.x, r.y)) * R2D;
  return { lon, lat };
}

/** True obliquity of date (degrees), including nutation. */
export function obliquity(t: AstronomyImport.AstroTime): number {
  return A.e_tilt(t).tobl;
}

/** Ecliptic-of-date (lon,lat) -> equatorial-of-date (ra,dec), for declination aspects and node/lilith declination. */
export function eclipticToEquatorial(
  lon: number,
  lat: number,
  t: AstronomyImport.AstroTime
): { ra: number; dec: number } {
  const eps = obliquity(t) * D2R;
  const l = lon * D2R;
  const b = lat * D2R;
  const sinDec = Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l);
  const dec = Math.asin(sinDec) * R2D;
  const y = Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps);
  const x = Math.cos(l);
  const ra = norm360(Math.atan2(y, x) * R2D);
  return { ra, dec };
}
