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
import type { AstroInput, SynastryPersonInput } from '../schemas/input';
import { SYNASTRY_CONVENTION_KEYS } from '../schemas/input';
import { computeChart, buildCtx, houseRangeCandidates, type AstroChart } from './chart';
import { houseOfLongitude } from './output';
import { robustCrossAspects, type CrossAspect } from './aspects';
import { bodyName, angleName, omissionReason, type Lang } from './i18n';
import { buildFrame, toAspectPositions, type PersonFrame } from './timeframe';

type Conventions = Partial<Pick<AstroInput, (typeof SYNASTRY_CONVENTION_KEYS)[number]>>;

export interface SynastryInput extends Conventions {
  personA: SynastryPersonInput;
  personB: SynastryPersonInput;
}

function mergeConventions(person: SynastryPersonInput, input: SynastryInput): AstroInput {
  const conv: Conventions = {};
  for (const key of SYNASTRY_CONVENTION_KEYS) {
    const v = input[key];
    if (v !== undefined) (conv as Record<string, unknown>)[key] = v;
  }
  // Every convention key but `orbs` has a zod default, so `conv` always
  // carries a value for those once parsed through `SynastryInputSchema` --
  // this cast just tells TS what runtime already guarantees.
  return { ...person, ...conv } as AstroInput;
}

/**
 * Every body/point (including the angles, when present) of `source` placed
 * into `target`'s houses -- `null` if `target` has none at all (a whole-day
 * window on `target`'s side, spec 4.3 mode C).
 *
 * `target.cusps` holds one cusp set per snapshot instant: one when `target`'s
 * birth time is exact, two when it is a known WINDOW (mode B) -- and `source`
 * itself may likewise have one or two body-position snapshots. Whichever side
 * has two, the placement can shift between the two ends, so it degrades to a
 * candidate list (via `houseRangeCandidates`, the same fixed-body-vs-moving-
 * house-heads sweep `chart.ts`'s own range mode already uses) rather than
 * collapsing to nothing.
 */
function overlay(source: PersonFrame, target: PersonFrame, lang: Lang) {
  if (!target.cusps) return null;
  const cuspsList = target.cusps;
  const targetRanged = cuspsList.length > 1;
  const sourceRanged = source.snapshots.length > 1;
  const names = [...source.snapshots[0].keys()];
  return names.map((internal) => {
    const displayName = internal === 'Ascendant' || internal === 'Midheaven'
      ? angleName(internal, lang) : bodyName(internal, lang);
    if (!targetRanged && !sourceRanged) {
      const house = houseOfLongitude(source.snapshots[0].get(internal)!.lon, cuspsList[0]);
      return { body: displayName, house };
    }
    const lonAt = (i: number) => source.snapshots[Math.min(i, source.snapshots.length - 1)].get(internal)!.lon;
    const cuspsAt = (i: number) => cuspsList[Math.min(i, cuspsList.length - 1)];
    const house0 = houseOfLongitude(lonAt(0), cuspsAt(0));
    const house1 = houseOfLongitude(lonAt(1), cuspsAt(1));
    // Direction matters: `houseRangeCandidates` always DECREMENTS from its
    // first argument to its second. When the TARGET's cusps are the side that
    // moves (rotating forward in time past a roughly-fixed body -- the same
    // physical setup chart.ts's own range mode uses), house0 -> house1 is the
    // correct decreasing sweep. When only the SOURCE moves (a body advancing
    // forward through the zodiac against fixed cusps), the true sweep is
    // ASCENDING house0 -> house1, which is the same set as decrementing from
    // house1 down to house0 -- so the arguments swap.
    const houseCandidates = targetRanged
      ? houseRangeCandidates(house0, house1)
      : houseRangeCandidates(house1, house0);
    // ponytail: does not detect a >12h window sweeping a full turn (chart.ts's
    // own computeRange does, via `sweepsFullTurn`) -- upgrade by threading the
    // window span through PersonFrame if a caller ever reports it as wrong.
    return { body: displayName, houseCandidates };
  });
}

export function computeSynastry(input: SynastryInput): AstroChart {
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

  const opts = {
    minorAspects: ctxA.minorAspects, declinationAspects: ctxA.declinationAspects, orbs: ctxA.orbs,
    southNodeAspects: ctxA.southNodeAspects,
  };
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
