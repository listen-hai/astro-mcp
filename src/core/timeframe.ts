/**
 * Resolves which instant(s) to sample body positions at, given the shared
 * three-mode time-precision input (spec 4.3): exact / range / date-only --
 * and the raw per-person "frame" (snapshot(s) of every body/point, plus
 * house cusps when exact) that synastry.ts and transits.ts both build one
 * of per natal chart.
 *
 * chart.ts already has the instant-resolution logic inline inside
 * computeExact/computeRange/computeDateOnly, but tangled up with the full
 * display assembly (candidate sign segments, house cusps, etc.) that those
 * modes' OUTPUT needs. synastry and transits only need the raw instant(s)
 * -- "one exact moment, or a pair bracketing a day/window" -- to sample
 * positions at, so this is factored out separately rather than reused from
 * chart.ts (and rather than duplicated across synastry.ts/transits.ts).
 */
import type { AstroInput } from '../schemas/input';
import { wallToUtc, wallToUtcOrGapEdge } from './time';
import { rawBodyPosition, POINTS, anglesAndHousesAt, type Ctx, type RawPos } from './chart';
import { pointPosition } from '../ephemeris/points';
import type { AspectPosition } from './aspects';
import { bodyName, angleName, type Lang } from './i18n';

export type Instants =
  | { mode: 'exact'; utc: Date }
  | { mode: 'range' | 'date_only'; t0: Date; t1: Date };

export function resolveInstants(input: AstroInput, ctx: Ctx): Instants {
  if (input.clockTime) {
    const { hour, minute } = input.clockTime;
    const utc = wallToUtc(ctx.year, ctx.month, ctx.day, hour, minute, ctx.timezone, input.dstFold ?? 0);
    return { mode: 'exact', utc };
  }

  if (input.clockTimeRange) {
    const { from, to } = input.clockTimeRange;
    const crossesMidnight = from.hour * 60 + from.minute > to.hour * 60 + to.minute;
    const fold = input.dstFold ?? 0;
    const t0 = wallToUtcOrGapEdge(ctx.year, ctx.month, ctx.day, from.hour, from.minute, ctx.timezone, fold);
    const t1 = wallToUtcOrGapEdge(
      ctx.year, ctx.month, ctx.day + (crossesMidnight ? 1 : 0), to.hour, to.minute, ctx.timezone, fold
    );
    return { mode: 'range', t0, t1 };
  }

  // date-only (spec 4.3 mode C): bracket the whole local day.
  const t0 = wallToUtcOrGapEdge(ctx.year, ctx.month, ctx.day, 0, 0, ctx.timezone);
  const t1 = wallToUtcOrGapEdge(ctx.year, ctx.month, ctx.day + 1, 0, 0, ctx.timezone);
  return { mode: 'date_only', t0, t1 };
}

/** Raw (tropical, unconverted) position of every body/point this project supports, at one instant. */
function snapshotRaw(ctx: Ctx, utc: Date): Map<string, RawPos> {
  const m = new Map<string, RawPos>();
  for (const name of ctx.bodies) m.set(name, rawBodyPosition(name, utc));
  for (const point of POINTS) m.set(point, pointPosition(point, utc, { node: ctx.node, lilith: ctx.lilithKind }));
  return m;
}

export interface PersonFrame {
  exact: boolean;
  /** One snapshot if the birth time is exact; two (bracketing the day/window) otherwise. */
  snapshots: Map<string, RawPos>[];
  /** Raw (tropical) house cusps -- present only when the birth time is exact. */
  cusps?: number[];
}

/** Builds one person's raw frame -- snapshot(s) of every body/point, angles/cusps only when exact. */
export function buildFrame(input: AstroInput, ctx: Ctx): PersonFrame {
  const instants = resolveInstants(input, ctx);
  if (instants.mode === 'exact') {
    const { ascendant, midheaven, houses } = anglesAndHousesAt(instants.utc, ctx.loc, ctx.houseSystem, ctx.zodiac);
    const raw = snapshotRaw(ctx, instants.utc);
    // NaN declination for the angles is deliberate: any comparison against NaN
    // is false in JS, so a declination-aspect check never spuriously fires for
    // a point that (unlike a body) has no real ecliptic latitude of its own.
    raw.set('Ascendant', { lon: ascendant, lat: 0, dec: NaN, speed: 0 });
    raw.set('Midheaven', { lon: midheaven, lat: 0, dec: NaN, speed: 0 });
    return { exact: true, snapshots: [raw], cusps: houses.cusps };
  }
  return { exact: false, snapshots: [snapshotRaw(ctx, instants.t0), snapshotRaw(ctx, instants.t1)] };
}

/** A raw snapshot as the `AspectPosition[]` shape `computeAspects`/`computeCrossAspects` need. */
export function toAspectPositions(raw: Map<string, RawPos>, lang: Lang): AspectPosition[] {
  return [...raw.entries()].map(([internal, pos]) => ({
    body: internal === 'Ascendant' || internal === 'Midheaven' ? angleName(internal, lang) : bodyName(internal, lang),
    lon: pos.lon,
    dec: pos.dec,
    speed: pos.speed,
    id: internal,
  }));
}
