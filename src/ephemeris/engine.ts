import * as AstronomyImport from 'astronomy-engine';
import { eclipticOfDate, eclipticToEquatorial } from './frames';
const A = ((AstronomyImport as unknown as { default?: typeof AstronomyImport }).default ??
  AstronomyImport) as typeof AstronomyImport;

/** The ten classical/modern major bodies astronomy-engine has a direct ephemeris for. */
const MAJOR_BODY: Record<string, AstronomyImport.Body> = {
  Sun: A.Body.Sun,
  Moon: A.Body.Moon,
  Mercury: A.Body.Mercury,
  Venus: A.Body.Venus,
  Mars: A.Body.Mars,
  Jupiter: A.Body.Jupiter,
  Saturn: A.Body.Saturn,
  Uranus: A.Body.Uranus,
  Neptune: A.Body.Neptune,
  Pluto: A.Body.Pluto,
};

function resolveBody(name: string): AstronomyImport.Body {
  const body = MAJOR_BODY[name];
  if (body === undefined) throw new Error(`Unknown major body: ${name}`);
  return body;
}

/** Geocentric apparent ecliptic-of-date position (light-time + aberration corrected). */
function geoEcliptic(name: string, date: Date): { lon: number; lat: number } {
  const t = A.MakeTime(date);
  const v = A.GeoVector(resolveBody(name), t, true);
  return eclipticOfDate(v, t);
}

export function bodyLongitude(name: string, date: Date): number {
  return geoEcliptic(name, date).lon;
}

export function bodyLatitude(name: string, date: Date): number {
  return geoEcliptic(name, date).lat;
}

export function bodyDeclination(name: string, date: Date): number {
  const t = A.MakeTime(date);
  const { lon, lat } = geoEcliptic(name, date);
  return eclipticToEquatorial(lon, lat, t).dec;
}

/** Daily motion in degrees/day via a +/-0.5 day central difference; negative means retrograde. */
export function bodySpeed(name: string, date: Date): number {
  const half = 12 * 3600 * 1000;
  const before = bodyLongitude(name, new Date(date.getTime() - half));
  const after = bodyLongitude(name, new Date(date.getTime() + half));
  let delta = after - before;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}
