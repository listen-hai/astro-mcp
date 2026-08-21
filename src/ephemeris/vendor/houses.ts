/**
 * Adapted from auseklis (MIT), https://github.com/igmizo/auseklis
 * Logic unchanged; transliterated from the published ESM build to TypeScript.
 * Full MIT text in this project's NOTICE.
 */

/**
 * House system solvers.
 *
 * Engine-agnostic: these take an Ascendant, Midheaven, location and obliquity
 * (all produced by the shared layer from any backend) and return 12 cusps.
 *
 * Implemented: Whole Sign, Equal, Porphyry, Placidus (iterative semi-arc).
 * Placidus is undefined above the polar circles; there it falls back to
 * Porphyry with an explanatory note.
 */
import { norm360, D2R, R2D } from '../frames';
import type { Location } from '../../types';

export type HouseSystem = 'placidus' | 'whole-sign' | 'equal' | 'porphyry';

export interface Houses {
  system: HouseSystem;
  cusps: number[];
  ascendant: number;
  midheaven: number;
  note?: string;
}

/** Forward arc from a to b, always positive, in [0, 360). */
function arc(a: number, b: number): number {
  return norm360(b - a);
}

/**
 * Whole Sign: each house is one whole sign, starting from the Ascendant's
 * sign. `ascendant` here is in the raw (tropical) frame that the rest of this
 * module works in, but "sign" is a display convention -- in a sidereal
 * zodiac, the sign boundary sits `ayanamsaOffset` degrees away from a
 * tropical multiple of 30. Floor in the DISPLAY frame, then shift back, so
 * the cusps still land exactly on sign boundaries once the caller converts
 * them back to display via the same offset.
 */
function wholeSign(ascendant: number, _midheaven: number, ayanamsaOffset: number): number[] {
  const displayAscendant = norm360(ascendant - ayanamsaOffset);
  const firstCuspDisplay = Math.floor(displayAscendant / 30) * 30;
  const firstCusp = norm360(firstCuspDisplay + ayanamsaOffset);
  return Array.from({ length: 12 }, (_, i) => norm360(firstCusp + i * 30));
}

/** Equal: 1st cusp = Ascendant, every subsequent cusp +30 deg. */
function equal(ascendant: number): number[] {
  return Array.from({ length: 12 }, (_, i) => norm360(ascendant + i * 30));
}

/**
 * Porphyry: trisect the ecliptic arcs between the four angles.
 * Cusps 1/4/7/10 are ASC/IC/DSC/MC; 2,3 trisect ASC->IC; 11,12 trisect MC->ASC; etc.
 */
function porphyry(ascendant: number, midheaven: number): number[] {
  const asc = norm360(ascendant);
  const mc = norm360(midheaven);
  const dsc = norm360(asc + 180);
  const ic = norm360(mc + 180);
  const cusps = new Array(12);
  cusps[0] = asc; // 1
  cusps[3] = ic; // 4
  cusps[6] = dsc; // 7
  cusps[9] = mc; // 10
  // Quadrant from MC down to ASC (houses 11, 12 fill MC->ASC)
  const mcToAsc = arc(mc, asc) / 3;
  cusps[10] = norm360(mc + mcToAsc); // 11
  cusps[11] = norm360(mc + 2 * mcToAsc); // 12
  // ASC -> IC (houses 2, 3)
  const ascToIc = arc(asc, ic) / 3;
  cusps[1] = norm360(asc + ascToIc); // 2
  cusps[2] = norm360(asc + 2 * ascToIc); // 3
  // IC -> DSC (houses 5, 6)
  const icToDsc = arc(ic, dsc) / 3;
  cusps[4] = norm360(ic + icToDsc); // 5
  cusps[5] = norm360(ic + 2 * icToDsc); // 6
  // DSC -> MC (houses 8, 9)
  const dscToMc = arc(dsc, mc) / 3;
  cusps[7] = norm360(dsc + dscToMc); // 8
  cusps[8] = norm360(dsc + 2 * dscToMc); // 9
  return cusps;
}

/** Signed shortest arc from b to a, in (-180, 180]. */
function signedArc(a: number, b: number): number {
  let d = norm360(a - b);
  if (d > 180) d -= 360;
  return d;
}

/** Ecliptic longitude (degrees) of the ecliptic point with right ascension ra (degrees). */
function eclipticLongitudeOfRA(ra: number, eps: number): number {
  return norm360(Math.atan2(Math.sin(ra * D2R), Math.cos(ra * D2R) * Math.cos(eps)) * R2D);
}

/**
 * Placidus: each intermediate cusp is the ecliptic point that has completed
 * the matching fraction of its semi-diurnal (houses 11, 12) or semi-nocturnal
 * (houses 2, 3) arc. Solved by fixed-point iteration on right ascension
 * (the classical semi-arc method); converges in a handful of iterations for
 * |latitude| below the polar circle. Returns null where the geometry is
 * undefined (circumpolar ecliptic degrees) or iteration fails to converge.
 */
function placidus(
  ascendant: number,
  midheaven: number,
  location: Location,
  obliquity: number
): number[] | null {
  const eps = obliquity * D2R;
  const phi = location.latitude * D2R;
  const mc = norm360(midheaven);
  // RAMC: right ascension of the MC (a point on the ecliptic at longitude mc).
  const ramc = norm360(Math.atan2(Math.sin(mc * D2R) * Math.cos(eps), Math.cos(mc * D2R)) * R2D);
  // offset: initial RA east of the meridian; f: semi-arc fraction;
  // nocturnal: measured back from the IC along the semi-nocturnal arc.
  const solve = (offset: number, f: number, nocturnal: boolean): number | null => {
    let ra = norm360(ramc + offset);
    for (let i = 0; i < 100; i++) {
      const lambda = eclipticLongitudeOfRA(ra, eps) * D2R;
      const delta = Math.asin(Math.sin(eps) * Math.sin(lambda)); // declination
      const x = Math.tan(phi) * Math.tan(delta);
      if (Math.abs(x) >= 1) return null; // circumpolar: no rise/set, Placidus undefined
      const ad = Math.asin(x) * R2D; // ascensional difference
      const next = nocturnal
        ? norm360(ramc + 180 - f * (90 - ad)) // semi-nocturnal arc = 90 - AD
        : norm360(ramc + f * (90 + ad)); // semi-diurnal arc = 90 + AD
      const step = Math.abs(signedArc(next, ra));
      ra = next;
      if (step < 1e-9) return eclipticLongitudeOfRA(ra, eps);
    }
    return null; // did not converge (only happens hard against the polar circle)
  };
  const c11 = solve(30, 1 / 3, false);
  const c12 = solve(60, 2 / 3, false);
  const c2 = solve(120, 2 / 3, true);
  const c3 = solve(150, 1 / 3, true);
  if (c11 === null || c12 === null || c2 === null || c3 === null) return null;
  const asc = norm360(ascendant);
  return [
    asc,
    c2,
    c3,
    norm360(mc + 180), // 4: IC
    norm360(c11 + 180), // 5
    norm360(c12 + 180), // 6
    norm360(asc + 180), // 7: DSC
    norm360(c2 + 180), // 8
    norm360(c3 + 180), // 9
    mc, // 10: MC
    c11,
    c12,
  ];
}

export function computeHouses(
  system: HouseSystem,
  ascendant: number,
  midheaven: number,
  location: Location,
  obliquity: number,
  ayanamsaOffset = 0
): Houses {
  switch (system) {
    case 'whole-sign':
      return { system, cusps: wholeSign(ascendant, midheaven, ayanamsaOffset), ascendant, midheaven };
    case 'equal':
      return { system, cusps: equal(ascendant), ascendant, midheaven };
    case 'porphyry':
      return { system, cusps: porphyry(ascendant, midheaven), ascendant, midheaven };
    case 'placidus': {
      const cusps = placidus(ascendant, midheaven, location, obliquity);
      if (cusps) return { system, cusps, ascendant, midheaven };
      return {
        system: 'placidus',
        cusps: porphyry(ascendant, midheaven),
        ascendant,
        midheaven,
        note:
          'Placidus is undefined at this latitude (above the polar circle); ' +
          'cusps were computed with Porphyry instead, which shares the same four angles.',
      };
    }
  }
}
