/**
 * Transits (行运): where the sky is RIGHT NOW (or at any given instant)
 * against a natal chart (v2).
 *
 * The transiting sky is always exact -- we know the target instant by
 * definition, there is nothing to degrade there. All the degradation is on
 * the natal side (task brief, the soul of this tool):
 *   - `transiting[].natalHouse` (which natal house a transiting body falls
 *     in) needs the natal houses, which need an exact natal birth time.
 *     Unknown natal time -> the field is OMITTED from every entry, not null.
 *   - Aspects to a natal angle (Ascendant/Midheaven) need the natal time to
 *     be exact for the same reason -- absent otherwise.
 *   - Planet-to-planet aspects survive regardless: the natal Sun/Mars/etc.
 *     position is known (if imprecisely) even without an exact birth time.
 *   - Any aspect touching the natal Moon is flagged `uncertain: true` when
 *     the natal time is not exact -- the Moon moves 12-15 deg/day.
 */
import type { AstroInput } from '../schemas/input';
import { computeChart, buildCtx, rawBodyPosition, POINTS, type AstroChart } from './chart';
import { pointPosition } from '../ephemeris/points';
import { houseOfLongitude } from './output';
import { robustCrossAspects, type CrossAspect } from './aspects';
import { bodyName, signOfLongitude, omissionReason } from './i18n';
import { toZodiac } from '../ephemeris/vendor/sidereal';
import { formatDegree } from './output';
import { wallToUtc } from './time';
import { resolveInstants, buildFrame, toAspectPositions } from './timeframe';

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

interface ClockTime {
  hour: number;
  minute: number;
}

export interface TransitsInput extends AstroInput {
  /** The instant to compute the transiting sky for. Omit entirely for "now". */
  target?: {
    solarDate: CalendarDate;
    clockTime: ClockTime;
    dstFold?: 0 | 1;
  };
}

export function computeTransits(input: TransitsInput): AstroChart {
  const ctx = buildCtx(input);
  const natalChart = computeChart(input);

  let targetUtc: Date;
  let targetSource: 'given' | 'now';
  if (input.target) {
    const { solarDate, clockTime, dstFold } = input.target;
    targetUtc = wallToUtc(
      solarDate.year, solarDate.month, solarDate.day, clockTime.hour, clockTime.minute, ctx.timezone, dstFold ?? 0
    );
    targetSource = 'given';
  } else {
    targetUtc = new Date();
    targetSource = 'now';
  }

  const natalInstants = resolveInstants(input, ctx);
  const earliestBirthMs = natalInstants.mode === 'exact' ? natalInstants.utc.getTime() : natalInstants.t0.getTime();
  if (targetUtc.getTime() < earliestBirthMs) {
    throw new Error(
      'The target instant is before the birth instant -- that is not a transit (a transit is the '
      + 'current/future sky against a chart that already exists).'
    );
  }

  // Transiting sky: always exact by construction (we know the target instant).
  const transiting = [
    ...ctx.bodies.map((name) => ({ name, raw: rawBodyPosition(name, targetUtc) })),
    ...POINTS.map((name) => ({ name, raw: pointPosition(name, targetUtc, { node: ctx.node, lilith: ctx.lilithKind }) })),
  ];

  const natalFrame = buildFrame(input, ctx);
  const natalExact = natalFrame.exact;
  const natalCusps = natalFrame.cusps;

  const transitingPositions = transiting.map(({ name, raw }) => {
    const disp = toZodiac(raw.lon, ctx.zodiac, targetUtc);
    return {
      body: bodyName(name, ctx.lang),
      sign: signOfLongitude(disp, ctx.lang),
      degree: formatDegree(disp),
      longitude: disp,
      latitude: raw.lat,
      declination: raw.dec,
      retrograde: raw.speed < 0,
      speed: raw.speed,
      ...(natalCusps ? { natalHouse: houseOfLongitude(raw.lon, natalCusps) } : {}),
    };
  });

  const transitingAspectPositions = toAspectPositions(
    new Map(transiting.map(({ name, raw }) => [name, raw])),
    ctx.lang
  );
  // Zeroed speed, deliberately: a natal position is frozen at birth, so the
  // conventional transit "applying/separating" is the TRANSITING body's own
  // motion closing or widening the orb against a stationary point -- not the
  // natal body's long-dead birth-epoch speed. Feeding the real birth-epoch
  // speed into isApplying would let ancient motion decide the flag (worst for
  // the Moon, ~13 deg/day at birth), producing a confident-looking wrong
  // value -- exactly what this project exists to refuse.
  const natalSnapshots = natalFrame.snapshots.map(
    (s) => toAspectPositions(s, ctx.lang).map((p) => ({ ...p, speed: 0 }))
  );

  const opts = { minorAspects: ctx.minorAspects, declinationAspects: ctx.declinationAspects, orbs: ctx.orbs };
  const moonName = bodyName('Moon', ctx.lang);

  const aspects = robustCrossAspects([transitingAspectPositions], natalSnapshots, opts).map((a: CrossAspect) => ({
    transiting: a.body1,
    natal: a.body2,
    aspect: a.aspect,
    ...(a.orb !== undefined ? { orb: a.orb } : { orbRange: a.orbRange }),
    ...(a.applying !== undefined ? { applying: a.applying } : {}),
    ...(a.body2 === moonName && !natalExact ? { uncertain: true } : {}),
  }));

  const omitted: { field: string; reason: string }[] = [];
  if (!natalCusps) {
    omitted.push({ field: 'transiting[].natalHouse', reason: omissionReason('transiting[].natalHouse', ctx.lang) });
  }
  if (natalSnapshots.length > 1) {
    omitted.push({ field: 'aspects[].applying', reason: omissionReason('aspects[].applying', ctx.lang) });
  }

  return {
    natal: natalChart,
    transiting: transitingPositions,
    aspects,
    diagnostics: {
      targetSource,
      targetUtc: targetUtc.toISOString(),
      houseSystem: ctx.houseSystem,
      zodiac: ctx.zodiac,
      node: ctx.node,
      lilith: ctx.lilithKind,
      orbs: ctx.diagnosticsBase.orbs,
      lang: ctx.lang,
      omitted,
    },
  };
}
