/**
 * Adapted from auseklis (MIT), https://github.com/igmizo/auseklis
 * Logic unchanged; transliterated from the published ESM build to TypeScript.
 * Full MIT text in this project's NOTICE.
 */

/**
 * Sidereal zodiac support via ayanamsa offsets.
 *
 * A sidereal longitude is the tropical longitude minus the ayanamsa -- the
 * accumulated precession since the zodiac's reference epoch. The two most
 * widely used ayanamsas are implemented from their published J2000 values and
 * the IAU general-precession rate (50.28796"/yr with a small secular term).
 * Accuracy is within ~1 arcminute of Swiss Ephemeris values for 1800-2200,
 * matching the backend's own +/-1' accuracy budget.
 */
import { norm360 } from '../frames';

export type Zodiac = 'tropical' | 'sidereal-lahiri' | 'sidereal-fagan-bradley';

const MS_PER_DAY = 86_400_000;

/** Published ayanamsa values at J2000.0, in degrees. */
const AYANAMSA_J2000: Record<Exclude<Zodiac, 'tropical'>, number> = {
  'sidereal-lahiri': 23.85316, // Lahiri (Chitrapaksha), 23d51'11"
  'sidereal-fagan-bradley': 24.736358, // Fagan/Bradley, 24d44'11"
};

/** Ayanamsa in degrees for a zodiac frame at an instant. 0 for tropical. */
export function ayanamsa(zodiac: Zodiac, date: Date): number {
  if (zodiac === 'tropical') return 0;
  const jd = date.getTime() / MS_PER_DAY + 2440587.5;
  const T = (jd - 2451545.0) / 36525; // Julian centuries since J2000
  // Integrated general precession in longitude: p(T) = 50.28796 + 0.0222*T "/yr.
  const accumulated = (50.28796 * (T * 100) + 0.0222 * T * (T * 100) * 0.5) / 3600;
  return AYANAMSA_J2000[zodiac] + accumulated;
}

/** Convert a tropical longitude to the requested zodiac frame. */
export function toZodiac(tropicalLongitude: number, zodiac: Zodiac, date: Date): number {
  return norm360(tropicalLongitude - ayanamsa(zodiac, date));
}
