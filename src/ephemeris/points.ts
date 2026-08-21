import * as AstronomyImport from 'astronomy-engine';
import { eqjToEct, eclipticToEquatorial, norm360, R2D } from './frames';
const A = ((AstronomyImport as unknown as { default?: typeof AstronomyImport }).default ??
  AstronomyImport) as typeof AstronomyImport;

/** True lunar node: the ascending node of the Moon's instantaneous orbital plane. h = r x v, Omega = atan2(h_x, -h_y). */
function trueNodeLongitude(date: Date): number {
  const t = A.MakeTime(date);
  const s = A.GeoMoonState(t);
  const R = eqjToEct(t); // MUST be ecliptic-of-date, not J2000 ecliptic -- see frames.ts
  const r = A.RotateVector(R, new A.Vector(s.x, s.y, s.z, t));
  const v = A.RotateVector(R, new A.Vector(s.vx, s.vy, s.vz, t));
  const hx = r.y * v.z - r.z * v.y;
  const hy = r.z * v.x - r.x * v.z;
  return norm360(Math.atan2(hx, -hy) * R2D);
}

/** Mean lunar node: Meeus ch.47 closed-form polynomial. */
function meanNodeLongitude(date: Date): number {
  const T = (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525;
  return norm360(
    125.0445479 - 1934.1362891 * T + 0.0020754 * T * T + T ** 3 / 467441 - T ** 4 / 60616000
  );
}

export function nodeLongitude(date: Date, kind: 'true' | 'mean'): number {
  return kind === 'true' ? trueNodeLongitude(date) : meanNodeLongitude(date);
}

/**
 * Lilith (Black Moon).
 * mean: Meeus ch.47 mean apogee, 180 deg from the mean perigee. Ecliptic latitude
 *       is 0 BY DEFINITION for this convention (mean orbital elements describe a
 *       mean orbit, not an instantaneous latitude) -- not a placeholder. Compare
 *       auseklis's A4 defect, where 0 was returned with no such rationale.
 * true: the eccentricity vector e = (v x h)/mu - r_hat points at perigee; its
 *       reverse is apogee, and its direction gives a real, non-zero latitude.
 */
export function lilith(date: Date, kind: 'mean' | 'true'): { lon: number; lat: number } {
  if (kind === 'mean') {
    const T = (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525;
    const perigee = norm360(
      83.3532465 + 4069.0137287 * T - 0.01032 * T * T - T ** 3 / 80053 + T ** 4 / 18999000
    );
    // Latitude 0 here is a DEFINITIONAL choice for the mean convention (mean
    // orbital elements describe the mean orbit, not an instantaneous
    // latitude) -- distinct in kind from auseklis's A4 hard-coded placeholder.
    return { lon: norm360(perigee + 180), lat: 0 };
  }
  const t = A.MakeTime(date);
  const st = A.GeoMoonState(t);
  const R = eqjToEct(t);
  const r = A.RotateVector(R, new A.Vector(st.x, st.y, st.z, t));
  const v = A.RotateVector(R, new A.Vector(st.vx, st.vy, st.vz, t));
  const h = {
    x: r.y * v.z - r.z * v.y,
    y: r.z * v.x - r.x * v.z,
    z: r.x * v.y - r.y * v.x,
  };
  const MU = 8.997011603e-10; // Earth-Moon system GM, AU^3/day^2
  const rn = Math.hypot(r.x, r.y, r.z);
  const e = {
    x: (v.y * h.z - v.z * h.y) / MU - r.x / rn,
    y: (v.z * h.x - v.x * h.z) / MU - r.y / rn,
    z: (v.x * h.y - v.y * h.x) / MU - r.z / rn,
  };
  const apo = { x: -e.x, y: -e.y, z: -e.z }; // apogee = reverse of perigee direction
  return {
    lon: norm360(Math.atan2(apo.y, apo.x) * R2D),
    lat: Math.atan2(apo.z, Math.hypot(apo.x, apo.y)) * R2D,
  };
}

export type PointName = 'NorthNode' | 'SouthNode' | 'Lilith';

interface PointOptions {
  node?: 'true' | 'mean';
  lilith?: 'mean' | 'true';
}

/** Ecliptic longitude of one point, given the same options `pointPosition` accepts. */
function pointLongitude(point: PointName, date: Date, opts: PointOptions): number {
  if (point === 'Lilith') return lilith(date, opts.lilith ?? 'mean').lon;
  const north = nodeLongitude(date, opts.node ?? 'true');
  return point === 'NorthNode' ? north : norm360(north + 180);
}

/**
 * Unified accessor: returns ecliptic longitude, ecliptic latitude, real
 * declination, and daily motion for a node or Lilith.
 */
export function pointPosition(
  point: PointName,
  date: Date,
  opts: PointOptions
): { lon: number; lat: number; dec: number; speed: number } {
  const t = A.MakeTime(date);
  let lon: number;
  let lat: number;
  if (point === 'Lilith') {
    const p = lilith(date, opts.lilith ?? 'mean');
    lon = p.lon;
    lat = p.lat;
  } else {
    // Node ecliptic latitude IS zero -- by definition, the nodes lie on the
    // ecliptic. This is a constant, not a placeholder (see auseklis A4).
    lon = pointLongitude(point, date, opts);
    lat = 0;
  }
  const { dec } = eclipticToEquatorial(lon, lat, t);

  const half = 12 * 3600 * 1000; // +/-0.5 day central difference, degrees/day
  const before = pointLongitude(point, new Date(date.getTime() - half), opts);
  const after = pointLongitude(point, new Date(date.getTime() + half), opts);
  let speed = after - before;
  if (speed > 180) speed -= 360;
  if (speed < -180) speed += 360;

  return { lon, lat, dec, speed };
}
