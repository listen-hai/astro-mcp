/**
 * Resolves which instant(s) to sample body positions at, given the shared
 * three-mode time-precision input (spec 4.3): exact / range / date-only.
 *
 * chart.ts already has this logic inline inside computeExact/computeRange/
 * computeDateOnly, but tangled up with the full display assembly (candidate
 * sign segments, house cusps, etc.) that those modes' OUTPUT needs. synastry
 * and transits only need the raw instant(s) -- "one exact moment, or a pair
 * bracketing a day/window" -- to sample positions at, so this is factored out
 * separately rather than reused from chart.ts (and rather than duplicated
 * twice more across synastry.ts/transits.ts).
 */
import type { AstroInput } from '../schemas/input';
import { wallToUtc, wallToUtcOrGapEdge } from './time';
import type { Ctx } from './chart';

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
