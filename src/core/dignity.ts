/**
 * Essential dignity: Domicile / Exaltation / Detriment / Fall.
 *
 * Static lookup table, no astronomy involved (spec 7.4). Triplicity / term /
 * face are classical-astrology subdivisions and deliberately out of scope
 * (spec 0) -- this project stops at the four dignities modern astrology kept.
 *
 * Outer-planet rulerships (Uranus/Aquarius, Neptune/Pisces, Pluto/Scorpio)
 * are a modern convention with no classical consensus; those table entries
 * carry `modern: true` so callers can distinguish them from the classical
 * seven-planet assignments.
 */
import { norm360 } from '../ephemeris/frames';

export type DignityKind = '庙' | '旺' | '陷' | '落' | null;

export interface Dignity {
  kind: DignityKind;
  modern: boolean;
}

interface Ruler {
  body: string;
  modern: boolean;
}

/** Domicile rulers by sign index (0 = Aries .. 11 = Pisces). Some signs have both a classical and a modern ruler. */
const DOMICILE: Ruler[][] = [
  [{ body: 'Mars', modern: false }], // Aries
  [{ body: 'Venus', modern: false }], // Taurus
  [{ body: 'Mercury', modern: false }], // Gemini
  [{ body: 'Moon', modern: false }], // Cancer
  [{ body: 'Sun', modern: false }], // Leo
  [{ body: 'Mercury', modern: false }], // Virgo
  [{ body: 'Venus', modern: false }], // Libra
  [
    { body: 'Mars', modern: false },
    { body: 'Pluto', modern: true },
  ], // Scorpio
  [{ body: 'Jupiter', modern: false }], // Sagittarius
  [{ body: 'Saturn', modern: false }], // Capricorn
  [
    { body: 'Saturn', modern: false },
    { body: 'Uranus', modern: true },
  ], // Aquarius
  [
    { body: 'Jupiter', modern: false },
    { body: 'Neptune', modern: true },
  ], // Pisces
];

/** Exaltation ruler by sign index; signs with none are omitted. */
const EXALTATION: Record<number, Ruler> = {
  0: { body: 'Sun', modern: false }, // Aries
  1: { body: 'Moon', modern: false }, // Taurus
  3: { body: 'Jupiter', modern: false }, // Cancer
  5: { body: 'Mercury', modern: false }, // Virgo
  6: { body: 'Saturn', modern: false }, // Libra
  9: { body: 'Mars', modern: false }, // Capricorn
  11: { body: 'Venus', modern: false }, // Pisces
};

function signIndex(lon: number): number {
  return Math.floor(norm360(lon) / 30);
}

export function dignityOf(body: string, lon: number): Dignity {
  const sign = signIndex(lon);
  const opposite = (sign + 6) % 12;

  const domicileHere = DOMICILE[sign].find((r) => r.body === body);
  if (domicileHere) return { kind: '庙', modern: domicileHere.modern };

  const exaltationHere = EXALTATION[sign];
  if (exaltationHere?.body === body) return { kind: '旺', modern: exaltationHere.modern };

  const domicileOpposite = DOMICILE[opposite].find((r) => r.body === body);
  if (domicileOpposite) return { kind: '陷', modern: domicileOpposite.modern };

  const exaltationOpposite = EXALTATION[opposite];
  if (exaltationOpposite?.body === body) return { kind: '落', modern: exaltationOpposite.modern };

  return { kind: null, modern: false };
}
