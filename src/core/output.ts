/**
 * Output formatting shared by all three time-precision modes (spec 9.2/9.3):
 * degree strings, house lookup by cusp, and the static orb table that goes
 * into `diagnostics.orbs`. Kept separate from chart.ts so the assembly
 * logic there isn't tangled up with string/number formatting.
 */
import { norm360 } from '../ephemeris/frames';
import { MAJOR_ASPECTS, MINOR_ASPECTS } from './aspects';
import { aspectName, type Lang } from './i18n';

/** Forward (always positive) arc from `a` to `b`, in [0, 360). */
export function fwdArc(a: number, b: number): number {
  return norm360(b - a);
}

/** Degrees/minutes within the body's own sign (0-30 deg), e.g. 24 deg 43'. */
export function degreeInSign(longitude: number): { deg: number; min: number } {
  const inSign = ((longitude % 30) + 30) % 30;
  let deg = Math.floor(inSign);
  let min = Math.round((inSign - deg) * 60);
  if (min === 60) {
    min = 0;
    deg += 1;
  }
  return { deg, min };
}

export function formatDegree(longitude: number): string {
  const { deg, min } = degreeInSign(longitude);
  return `${deg}°${String(min).padStart(2, '0')}'`;
}

/**
 * Which of the 12 houses (1-indexed) a longitude falls in, given the 12 cusp
 * longitudes in cusps[0..11] (house 1's cusp .. house 12's cusp). Both the
 * body longitude and the cusps must be in the SAME frame (raw tropical) --
 * the zodiac (sidereal) display conversion must never leak into this
 * comparison, since house geometry is physical, not a display convention.
 */
export function houseOfLongitude(longitude: number, cusps: number[]): number {
  const n = cusps.length;
  for (let i = 0; i < n; i++) {
    const start = cusps[i];
    const end = cusps[(i + 1) % n];
    const span = fwdArc(start, end);
    const rel = fwdArc(start, longitude);
    if (span === 0 || rel < span) return i + 1;
  }
  return n;
}

/** Static default orb table (spec 8) -- not currently exposed as an input override.
 * Keys are aspect names in the requested display language: this is user-facing
 * diagnostics output, governed by the same `lang` switch as everything else. */
export function defaultOrbTable(minorAspects: boolean, lang: Lang): Record<string, number> {
  const table: Record<string, number> = {};
  for (const d of MAJOR_ASPECTS) table[aspectName(d.name, lang)] = d.orb;
  if (minorAspects) for (const d of MINOR_ASPECTS) table[aspectName(d.name, lang)] = d.orb;
  return table;
}

/** Format a UTC instant as local "HH:MM" wall-clock in the given IANA timezone. */
export function formatLocalTime(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}
