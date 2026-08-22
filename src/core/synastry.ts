/**
 * Synastry (合盘): aspects and house overlays BETWEEN two natal charts (v2).
 *
 * Directional by construction (task brief -- the soul of this tool):
 *   - "A's Mars falls in B's 7th house" needs B to have houses, which needs
 *     an exact birth time for B. If B's time is unknown, `overlays.aInB` is
 *     simply empty (and reported in `diagnostics.omitted`) while
 *     `overlays.bInA` (needs A's houses, A is still exact) proceeds normally.
 *   - Ascendant/Midheaven aspects only exist for whichever person has an
 *     exact time -- there is no Ascendant to aspect otherwise.
 *   - The Moon moves 12-15 deg/day, so any aspect touching a Moon whose
 *     side's birth time is unknown is flagged `uncertain: true` rather than
 *     silently reported as if it were exact.
 *   - `applying` is never included: two natal charts are each frozen at
 *     their own birth instant, so "approaching exactness" has no meaning
 *     across two different epochs the way it does for a single chart.
 */
import type { AstroInput } from '../schemas/input';
import { computeChart, buildCtx, rawBodyPosition, POINTS, anglesAndHousesAt, type Ctx, type RawPos } from './chart';
import { pointPosition } from '../ephemeris/points';
import { houseOfLongitude } from './output';
import { computeCrossAspects, robustCrossAspects, type AspectPosition, type CrossAspect } from './aspects';
import { bodyName, angleName, omissionReason, type Lang } from './i18n';
import { resolveInstants } from './timeframe';

type Conventions = Partial<Pick<AstroInput,
  'houseSystem' | 'zodiac' | 'node' | 'lilith' | 'orbs' |
  'minorAspects' | 'declinationAspects' | 'asteroids' | 'chiron' | 'lang'
>>;

export interface SynastryInput extends Conventions {
  personA: AstroInput;
  personB: AstroInput;
}

const CONVENTION_KEYS = [
  'houseSystem', 'zodiac', 'node', 'lilith', 'orbs',
  'minorAspects', 'declinationAspects', 'asteroids', 'chiron', 'lang',
] as const;

function mergeConventions(person: AstroInput, input: SynastryInput): AstroInput {
  const conv: Conventions = {};
  for (const key of CONVENTION_KEYS) {
    const v = input[key];
    if (v !== undefined) (conv as Record<string, unknown>)[key] = v;
  }
  return { ...person, ...conv };
}

/** Raw (tropical, unconverted) position of every body/point this project supports, at one instant. */
function snapshotRaw(ctx: Ctx, utc: Date): Map<string, RawPos> {
  const m = new Map<string, RawPos>();
  for (const name of ctx.bodies) m.set(name, rawBodyPosition(name, utc));
  for (const point of POINTS) m.set(point, pointPosition(point, utc, { node: ctx.node, lilith: ctx.lilithKind }));
  return m;
}

interface PersonFrame {
  exact: boolean;
  /** One snapshot if the birth time is exact; two (bracketing the day/window) otherwise. */
  snapshots: Map<string, RawPos>[];
  /** Raw (tropical) house cusps -- present only when the birth time is exact. */
  cusps?: number[];
}

function buildFrame(input: AstroInput, ctx: Ctx): PersonFrame {
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

function toAspectPositions(raw: Map<string, RawPos>, lang: Lang): AspectPosition[] {
  return [...raw.entries()].map(([internal, pos]) => ({
    body: internal === 'Ascendant' || internal === 'Midheaven' ? angleName(internal, lang) : bodyName(internal, lang),
    lon: pos.lon,
    dec: pos.dec,
    speed: pos.speed,
    id: internal,
  }));
}

/** Every body/point (including the angles, when present) of `source` placed into `target`'s houses -- `null` if `target` has none. */
function overlay(source: PersonFrame, target: PersonFrame, lang: Lang) {
  if (!target.cusps) return null;
  const cusps = target.cusps;
  const names = [...source.snapshots[0].keys()];
  return names.map((internal) => {
    const houses = [...new Set(source.snapshots.map((snap) => houseOfLongitude(snap.get(internal)!.lon, cusps)))];
    const displayName = internal === 'Ascendant' || internal === 'Midheaven'
      ? angleName(internal, lang) : bodyName(internal, lang);
    return houses.length === 1
      ? { body: displayName, house: houses[0] }
      : { body: displayName, houseCandidates: houses };
  });
}

export function computeSynastry(input: SynastryInput) {
  const mergedA = mergeConventions(input.personA, input);
  const mergedB = mergeConventions(input.personB, input);

  const chartA = computeChart(mergedA);
  const chartB = computeChart(mergedB);

  const ctxA = buildCtx(mergedA);
  const ctxB = buildCtx(mergedB);
  const lang = ctxA.lang;

  const frameA = buildFrame(mergedA, ctxA);
  const frameB = buildFrame(mergedB, ctxB);

  const positionsA = frameA.snapshots.map((s) => toAspectPositions(s, lang));
  const positionsB = frameB.snapshots.map((s) => toAspectPositions(s, lang));

  const opts = { minorAspects: ctxA.minorAspects, declinationAspects: ctxA.declinationAspects, orbs: ctxA.orbs };
  const moonName = bodyName('Moon', lang);

  const aspects = robustCrossAspects(positionsA, positionsB, opts).map((a: CrossAspect) => ({
    bodyA: a.body1,
    bodyB: a.body2,
    aspect: a.aspect,
    ...(a.orb !== undefined ? { orb: a.orb } : { orbRange: a.orbRange }),
    from: 'A' as const,
    to: 'B' as const,
    ...((a.body1 === moonName && !frameA.exact) || (a.body2 === moonName && !frameB.exact)
      ? { uncertain: true }
      : {}),
  }));

  const omitted: { field: string; reason: string }[] = [
    { field: 'aspects[].applying', reason: omissionReason('aspects[].applying', lang) },
  ];
  const aInB = overlay(frameA, frameB, lang);
  const bInA = overlay(frameB, frameA, lang);
  if (!aInB) omitted.push({ field: 'overlays.aInB', reason: omissionReason('overlays.aInB', lang) });
  if (!bInA) omitted.push({ field: 'overlays.bInA', reason: omissionReason('overlays.bInA', lang) });

  return {
    personA: chartA,
    personB: chartB,
    aspects,
    overlays: { aInB: aInB ?? [], bInA: bInA ?? [] },
    diagnostics: {
      houseSystem: ctxA.houseSystem,
      zodiac: ctxA.zodiac,
      node: ctxA.node,
      lilith: ctxA.lilithKind,
      orbs: ctxA.diagnosticsBase.orbs,
      lang,
      omitted,
    },
  };
}

// computeCrossAspects is re-exported only for tests/tools that may want the
// unconditional (non-degradation-aware) primitive directly.
export { computeCrossAspects };
