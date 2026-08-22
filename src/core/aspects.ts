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
  /** Orb overrides keyed by the language-independent aspect key,
   * e.g. { conjunction: 10 }. Unknown keys throw. */
  orbs?: Partial<Record<string, number>>;
  /** Orb for parallel/contraparallel declination aspects (default 1 deg). */
  declinationOrb?: number;
  /** Include aspects touching the South Node. Off by default: the South Node
   * is 180 deg from the North Node by construction, so any aspect to it is
   * an automatic, same-orb mirror of one to the North Node -- reporting both
   * doubles the node rows for zero new fact (astro.com/astro-seek/TimePassages/
   * 爱星盘 all default to hiding it). See the mirror-awareness note below. */
  southNodeAspects?: boolean;
}

interface AspectDef {
  /** Language-independent identifier. Orb overrides key off this, so the API
   * shape does not change with `lang`. */
  key: string;
  name: string;
  angle: number;
  orb: number;
}

export const MAJOR_ASPECTS: AspectDef[] = [
  { key: 'conjunction', name: '合', angle: 0, orb: 8 },
  { key: 'sextile', name: '六合', angle: 60, orb: 6 },
  { key: 'square', name: '刑', angle: 90, orb: 7 },
  { key: 'trine', name: '拱', angle: 120, orb: 7 },
  { key: 'opposition', name: '冲', angle: 180, orb: 8 },
];

export const MINOR_ASPECTS: AspectDef[] = [
  { key: 'semisextile', name: '半六合', angle: 30, orb: 2 },
  // 45 deg is 八分相 (semi-square, also 半刑). An earlier table labelled it
  // 八分之三 -- that is the name of the 135 deg aspect, which was missing
  // entirely. Verified against Chinese astrology references, not assumed.
  { key: 'semisquare', name: '八分相', angle: 45, orb: 2 },
  { key: 'quintile', name: '五分相', angle: 72, orb: 2 },
  { key: 'sesquiquadrate', name: '补八分相', angle: 135, orb: 2 },
  { key: 'quincunx', name: '补十二', angle: 150, orb: 3 },
];

/** Every orb key a caller may legally pass. */
export const ORB_KEYS = [...MAJOR_ASPECTS, ...MINOR_ASPECTS].map((a) => a.key);

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

/** Throws on any orb-override key not in ORB_KEYS -- shared by both aspect entry points below. */
function assertKnownOrbKeys(orbs?: Partial<Record<string, number>>): void {
  for (const key of Object.keys(orbs ?? {})) {
    if (!ORB_KEYS.includes(key)) {
      throw new Error(
        `Unknown aspect in \`orbs\`: "${key}". Valid keys: ${ORB_KEYS.join(', ')}.`
      );
    }
  }
}

/** Every aspect (major/minor + declination) found between one specific pair of positions. */
function aspectsForPair(
  p1: AspectPosition,
  p2: AspectPosition,
  defs: AspectDef[],
  opts: AspectOptions,
  declinationOrb: number
): Aspect[] {
  const results: Aspect[] = [];
  const sep = separation(p1.lon, p2.lon);
  const touchesSouthNode = p1.id === 'SouthNode' || p2.id === 'SouthNode';
  const suppressSouthNode = touchesSouthNode && !opts.southNodeAspects;

  for (const def of defs) {
    const orb = opts.orbs?.[def.key] ?? def.orb;
    const delta = Math.abs(sep - def.angle);
    if (delta <= orb) {
      // South Node aspects are suppressed by default -- but only when they are
      // genuinely redundant. The Node axis is 180 deg by construction, so an
      // aspect of angle X to the South Node guarantees one of angle (180 - X)
      // to the North Node at the identical orb. That mirror is only a fact
      // already captured elsewhere if (180 - X) is itself a currently active
      // aspect type (e.g. quintile's 108 deg mirror is not a defined aspect at
      // all, so "planet quintile South Node" would vanish entirely rather
      // than deduplicate -- it must stay).
      if (suppressSouthNode) {
        const mirrorAngle = 180 - def.angle;
        const mirrorIsActive = defs.some((d) => d.angle === mirrorAngle);
        if (mirrorIsActive) break; // redundant with the equivalent North Node aspect
      }
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

  // Declination parallel/contraparallel has no separate "types" to be
  // mirror-aware about the way major/minor angles do -- the South Node's
  // declination is always the negative of the North Node's, so "P parallel
  // SouthNode" and "P contraparallel NorthNode" are the same fact whenever
  // declination aspects are even on. Unconditional suppression here, unlike
  // the angle-based check above.
  if (opts.declinationAspects && !suppressSouthNode) {
    const parallelOrb = Math.abs(p1.dec - p2.dec);
    const contraOrb = Math.abs(p1.dec + p2.dec);
    if (parallelOrb <= declinationOrb) {
      results.push({ body1: p1.body, body2: p2.body, aspect: '平行', orb: parallelOrb });
    } else if (contraOrb <= declinationOrb) {
      results.push({ body1: p1.body, body2: p2.body, aspect: '反平行', orb: contraOrb });
    }
  }

  return results;
}

export function computeAspects(positions: AspectPosition[], opts: AspectOptions): Aspect[] {
  const defs = [...MAJOR_ASPECTS, ...(opts.minorAspects ? MINOR_ASPECTS : [])];
  const declinationOrb = opts.declinationOrb ?? 1;
  assertKnownOrbKeys(opts.orbs);

  const results: Aspect[] = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const p1 = positions[i];
      const p2 = positions[j];
      // Same-chart North/South Node axis is a construction, not information
      // (see isNodeAxis) -- this exclusion only holds WITHIN one chart, so
      // computeCrossAspects below (two different charts/epochs) does not apply it.
      if (isNodeAxis(p1.id, p2.id)) continue;
      results.push(...aspectsForPair(p1, p2, defs, opts, declinationOrb));
    }
  }
  return results;
}

/**
 * Aspects strictly BETWEEN two position lists (every `from` paired with every
 * `to`), never within either list -- the shape synastry (person A vs person B)
 * and transits (transiting sky vs natal chart) both need. `body1` is always
 * from `from`, `body2` always from `to`, so callers can rely on that order.
 *
 * No North/South Node-axis exclusion here: that 180-degree relationship is
 * guaranteed only within a single chart's own node line at one instant --
 * across two different charts/epochs, node-vs-node is a real, informative
 * aspect, not a mathematical certainty.
 */
export function computeCrossAspects(
  from: AspectPosition[],
  to: AspectPosition[],
  opts: AspectOptions
): Aspect[] {
  const defs = [...MAJOR_ASPECTS, ...(opts.minorAspects ? MINOR_ASPECTS : [])];
  const declinationOrb = opts.declinationOrb ?? 1;
  assertKnownOrbKeys(opts.orbs);

  const results: Aspect[] = [];
  for (const p1 of from) {
    for (const p2 of to) {
      results.push(...aspectsForPair(p1, p2, defs, opts, declinationOrb));
    }
  }
  return results;
}

/** Same shape as `Aspect`, except an uncertain source reports a range instead
 * of a single orb, and `applying` is present only when both sides are exact
 * (see `robustCrossAspects`). */
export interface CrossAspect {
  body1: string;
  body2: string;
  aspect: string;
  orb?: number;
  orbRange?: [number, number];
  applying?: boolean;
}

/**
 * `computeCrossAspects`, but honest about an unknown time on either side:
 * each side may be a single exact snapshot OR a pair of snapshots bracketing
 * a day/window (spec 4.3's "must hold at every endpoint" rule, extended from
 * one chart to two). An aspect survives only if it appears in EVERY
 * (fromSnapshot, toSnapshot) combination; its orb is a single number when
 * there was only one combination to check, otherwise a [min, max] range.
 * `applying` needs a genuine instant on both sides, so it is only kept in
 * the single-combination case.
 */
export function robustCrossAspects(
  fromSnapshots: AspectPosition[][],
  toSnapshots: AspectPosition[][],
  opts: AspectOptions
): CrossAspect[] {
  const keyOf = (a: Aspect) => `${a.body1}|${a.body2}|${a.aspect}`;
  const perCombo = fromSnapshots.flatMap((f) => toSnapshots.map((t) => computeCrossAspects(f, t, opts)));
  if (perCombo.length === 0) return [];

  const maps = perCombo.map((asps) => new Map(asps.map((a) => [keyOf(a), a])));
  const survivingKeys = [...maps[0].keys()].filter((k) => maps.every((m) => m.has(k)));
  const uniform = perCombo.length === 1;

  return survivingKeys.map((k) => {
    const instances = maps.map((m) => m.get(k)!);
    const orbs = instances.map((a) => a.orb);
    return {
      body1: instances[0].body1,
      body2: instances[0].body2,
      aspect: instances[0].aspect,
      ...(uniform
        ? { orb: orbs[0], applying: instances[0].applying }
        : { orbRange: [Math.min(...orbs), Math.max(...orbs)] as [number, number] }),
    };
  });
}
