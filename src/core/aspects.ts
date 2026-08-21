/**
 * Aspects between body positions.
 *
 * Orbs are keyed to the ASPECT TYPE (conjunction 8, square/trine 7, sextile
 * 6), the modern-astrology convention -- not to the bodies' moiety (classical
 * astrology keys orbs to each body's own light, see spec 0). That distinction
 * is deliberate and out of scope to "fix": this project is modern astrology.
 */
import { norm360 } from '../ephemeris/frames';

export interface AspectPosition {
  body: string;
  lon: number;
  dec: number;
  speed: number;
  /** Internal (language-independent) identifier, used only to recognize the
   * lunar-node axis below -- `body` is already the display name. */
  id?: string;
}

export interface Aspect {
  body1: string;
  body2: string;
  aspect: string;
  orb: number;
  applying?: boolean;
}

export interface AspectOptions {
  minorAspects?: boolean;
  declinationAspects?: boolean;
  /** Per-aspect-name orb overrides, e.g. { 合: 10 }. */
  orbs?: Partial<Record<string, number>>;
  /** Orb for parallel/contraparallel declination aspects (default 1 deg). */
  declinationOrb?: number;
}

interface AspectDef {
  name: string;
  angle: number;
  orb: number;
}

export const MAJOR_ASPECTS: AspectDef[] = [
  { name: '合', angle: 0, orb: 8 },
  { name: '六合', angle: 60, orb: 6 },
  { name: '刑', angle: 90, orb: 7 },
  { name: '拱', angle: 120, orb: 7 },
  { name: '冲', angle: 180, orb: 8 },
];

export const MINOR_ASPECTS: AspectDef[] = [
  { name: '半六合', angle: 30, orb: 2 },
  { name: '八分之三', angle: 45, orb: 2 },
  { name: '五分相', angle: 72, orb: 2 },
  { name: '补十二', angle: 150, orb: 3 },
];

/** The North/South Node axis is 180 deg apart BY CONSTRUCTION (opposite points
 * of the same node line), and their declinations are equal and opposite for
 * the same reason -- so every "aspect" between them (opposition at orb 0,
 * contraparallel) is a mathematical certainty, not information about the
 * chart. Lilith-node aspects are real and stay in. */
function isNodeAxis(id1: string | undefined, id2: string | undefined): boolean {
  const pair = new Set([id1, id2]);
  return pair.has('NorthNode') && pair.has('SouthNode');
}

/** Absolute angular separation between two ecliptic longitudes, in [0, 180]. */
function separation(lon1: number, lon2: number): number {
  const d = norm360(lon2 - lon1);
  return d > 180 ? 360 - d : d;
}

/**
 * Whether a pair is closing in on exactness (applying) or pulling away
 * (separating). Simulated by nudging both longitudes forward one small step
 * at their current daily speeds and checking whether the orb shrinks -- this
 * sidesteps sign bookkeeping and works uniformly at 0 deg/180 deg wraparound.
 */
function isApplying(p1: AspectPosition, p2: AspectPosition, angle: number, orbNow: number): boolean {
  const dt = 0.001; // days
  const l1 = p1.lon + p1.speed * dt;
  const l2 = p2.lon + p2.speed * dt;
  const orbNext = Math.abs(separation(l1, l2) - angle);
  return orbNext < orbNow;
}

export function computeAspects(positions: AspectPosition[], opts: AspectOptions): Aspect[] {
  const defs = [...MAJOR_ASPECTS, ...(opts.minorAspects ? MINOR_ASPECTS : [])];
  const declinationOrb = opts.declinationOrb ?? 1;
  const results: Aspect[] = [];

  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const p1 = positions[i];
      const p2 = positions[j];
      if (isNodeAxis(p1.id, p2.id)) continue;
      const sep = separation(p1.lon, p2.lon);

      for (const def of defs) {
        const orb = opts.orbs?.[def.name] ?? def.orb;
        const delta = Math.abs(sep - def.angle);
        if (delta <= orb) {
          results.push({
            body1: p1.body,
            body2: p2.body,
            aspect: def.name,
            orb: delta,
            applying: isApplying(p1, p2, def.angle, delta),
          });
          break; // aspect windows never overlap given the orbs above
        }
      }

      if (opts.declinationAspects) {
        const parallelOrb = Math.abs(p1.dec - p2.dec);
        const contraOrb = Math.abs(p1.dec + p2.dec);
        if (parallelOrb <= declinationOrb) {
          results.push({ body1: p1.body, body2: p2.body, aspect: '平行', orb: parallelOrb });
        } else if (contraOrb <= declinationOrb) {
          results.push({ body1: p1.body, body2: p2.body, aspect: '反平行', orb: contraOrb });
        }
      }
    }
  }

  return results;
}
