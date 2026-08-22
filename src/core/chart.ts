/**
 * Three-mode chart assembly (spec 4.3): the central "no faking it" promise.
 *
 * `computeChart` dispatches on which of `clockTime` / `clockTimeRange` is
 * present:
 *   - exact       -- full chart, no degradation.
 *   - range       -- Ascendant/Midheaven reduce to candidate segments;
 *                    everything Ascendant-dependent (houses, PartOfFortune)
 *                    degrades with them.
 *   - date_only   -- angles/houses/PartOfFortune are OMITTED FIELDS, not
 *                    null placeholders; bodies get a degree range across
 *                    the day and, on a sign-crossing day, two candidates.
 *
 * Degradation is implemented by never assigning the field in the first
 * place -- not by computing it and deleting/nulling it afterwards.
 */
import * as AstronomyImport from 'astronomy-engine';
import rootPkg from '../../package.json';
import type { AstroInput } from '../schemas/input';
import { ASTRO_DEFAULTS } from '../schemas/input';
import type { Location } from '../types';
import { resolveLocation } from '../geo/resolver';
import { wallToUtc, wallToUtcOrGapEdge, assertValidCalendarDate } from './time';
import { bodyLongitude, bodyLatitude, bodyDeclination, bodySpeed } from '../ephemeris/engine';
import { computeAngles } from '../ephemeris/angles';
import { computeHouses, type HouseSystem, type Houses } from '../ephemeris/vendor/houses';
import { pointPosition, type PointName } from '../ephemeris/points';
import { smallBodyPosition } from '../ephemeris/smallbodies';
import { computeAspects, type AspectPosition } from './aspects';
import { dignityOf } from './dignity';
import { toZodiac, ayanamsa, type Zodiac } from '../ephemeris/vendor/sidereal';
import { obliquity, norm360 } from '../ephemeris/frames';
import {
  type Lang,
  signOfLongitude,
  signIndexOf,
  signNameByIndex,
  bodyName,
  aspectName,
  omissionReason,
  dignityDisplay,
  ACCURACY_NOTE,
} from './i18n';
import { formatDegree, houseOfLongitude, effectiveOrbTable, formatLocalTime, fwdArc } from './output';

const A = ((AstronomyImport as unknown as { default?: typeof AstronomyImport }).default ??
  AstronomyImport) as typeof AstronomyImport;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AstroChart = Record<string, any>;

const MAJOR_BODIES = [
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
] as const;
const ASTEROIDS = ['Ceres', 'Pallas', 'Juno', 'Vesta'] as const;
export const POINTS: readonly PointName[] = ['NorthNode', 'SouthNode', 'Lilith'];

export function bodyList(chironOn: boolean, asteroidsOn: boolean): string[] {
  return [
    ...MAJOR_BODIES,
    ...(chironOn ? ['Chiron'] : []),
    ...(asteroidsOn ? ASTEROIDS : []),
  ];
}

export interface RawPos {
  lon: number;
  lat: number;
  dec: number;
  speed: number;
}

/** Raw (tropical, unconverted) geocentric position for any body this project supports. */
export function rawBodyPosition(name: string, date: Date): RawPos {
  if ((MAJOR_BODIES as readonly string[]).includes(name)) {
    return {
      lon: bodyLongitude(name, date),
      lat: bodyLatitude(name, date),
      dec: bodyDeclination(name, date),
      speed: bodySpeed(name, date),
    };
  }
  return smallBodyPosition(name, date);
}

function astronomyEngineVersion(): string {
  const deps = (rootPkg as { dependencies?: Record<string, string> }).dependencies;
  return deps?.['astronomy-engine'] ?? 'unknown';
}

function obliquityAt(date: Date): number {
  return obliquity(A.MakeTime(date));
}

export function anglesAndHousesAt(
  date: Date,
  loc: Location,
  system: HouseSystem,
  zodiac: Zodiac
): { ascendant: number; midheaven: number; houses: Houses; degenerate: boolean } {
  const angles = computeAngles(date, loc);
  // Whole Sign cusps must land on sign boundaries in the DISPLAY zodiac, not
  // the raw tropical one (spec: sidereal + whole-sign) -- pass the ayanamsa
  // through so it can floor in the right frame.
  const houses = computeHouses(
    system,
    angles.ascendant,
    angles.midheaven,
    loc,
    obliquityAt(date),
    ayanamsa(zodiac, date)
  );
  return { ascendant: angles.ascendant, midheaven: angles.midheaven, houses, degenerate: angles.degenerate };
}

/** Shared, mode-independent setup: conventions, location, the body list, and the diagnostics fields common to every mode. */
export interface Ctx {
  houseSystem: HouseSystem;
  zodiac: Zodiac;
  node: 'true' | 'mean';
  lilithKind: 'mean' | 'true';
  minorAspects: boolean;
  declinationAspects: boolean;
  southNodeAspects: boolean;
  orbs?: Record<string, number>;
  chironOn: boolean;
  asteroidsOn: boolean;
  lang: Lang;
  loc: Location;
  timezone: string;
  placeName: string | null;
  year: number;
  month: number;
  day: number;
  bodies: string[];
  diagnosticsBase: Record<string, unknown>;
}

export function buildCtx(input: AstroInput): Ctx {
  const houseSystem = (input.houseSystem ?? ASTRO_DEFAULTS.houseSystem) as HouseSystem;
  const zodiac = (input.zodiac ?? ASTRO_DEFAULTS.zodiac) as Zodiac;
  const node = (input.node ?? ASTRO_DEFAULTS.node) as 'true' | 'mean';
  const lilithKind = (input.lilith ?? ASTRO_DEFAULTS.lilith) as 'mean' | 'true';
  const minorAspects = input.minorAspects ?? ASTRO_DEFAULTS.minorAspects;
  const declinationAspects = input.declinationAspects ?? ASTRO_DEFAULTS.declinationAspects;
  const southNodeAspects = input.southNodeAspects ?? ASTRO_DEFAULTS.southNodeAspects;
  const chironOn = input.chiron ?? ASTRO_DEFAULTS.chiron;
  const asteroidsOn = input.asteroids ?? ASTRO_DEFAULTS.asteroids;
  const lang = (input.lang ?? ASTRO_DEFAULTS.lang) as Lang;

  assertValidCalendarDate(input.solarDate.year, input.solarDate.month, input.solarDate.day);

  // Guard here rather than only in the zod schema: computeChart is exported and
  // callable directly, so the schema's refine does not cover every caller.
  // Latitude drives the Ascendant and every cusp, so blending an explicit one
  // into a resolved city yields a chart for neither location -- silently.
  if (input.place && (input.latitude !== undefined || input.longitude !== undefined)) {
    throw new Error(
      'Pass either `place` or explicit `longitude`+`latitude`+`timezone`, not both. '
      + 'Latitude drives the Ascendant, so grafting one onto a resolved city would '
      + 'silently produce a chart for neither location.'
    );
  }

  const resolved = resolveLocation({ place: input.place, longitude: input.longitude, timezone: input.timezone });
  const latitude = input.latitude ?? resolved.latitude;
  if (latitude === undefined) {
    throw new Error(
      'Could not determine birth latitude: pass `place`, or all of `longitude` + `latitude` + `timezone`.'
    );
  }

  const included = [...(chironOn ? ['chiron'] : []), ...(asteroidsOn ? ['asteroids'] : [])];

  return {
    houseSystem,
    zodiac,
    node,
    lilithKind,
    minorAspects,
    declinationAspects,
    southNodeAspects,
    orbs: input.orbs,
    chironOn,
    asteroidsOn,
    lang,
    loc: { latitude, longitude: resolved.longitude },
    timezone: resolved.timezone,
    placeName: resolved.placeName ?? input.place ?? null,
    year: input.solarDate.year,
    month: input.solarDate.month,
    day: input.solarDate.day,
    bodies: bodyList(chironOn, asteroidsOn),
    diagnosticsBase: {
      houseSystem,
      zodiac,
      node,
      lilith: lilithKind,
      orbs: effectiveOrbTable(minorAspects, lang, input.orbs),
      included,
      ephemeris: `astronomy-engine@${astronomyEngineVersion()}`,
      accuracyNote: ACCURACY_NOTE[lang],
      location: {
        source: resolved.locationSource,
        warning: resolved.mixedWarning ?? null,
        alternateTimezones: resolved.alternateTimezones ?? null,
      },
    },
  };
}

/**
 * Snaps a longitude to 1e-9 degrees and re-wraps into [0, 360). Whole Sign
 * cusps are analytically exact multiples of 30 in the display zodiac, but
 * reaching them via raw-frame arithmetic (add the ayanamsa, then subtract it
 * again in a different magnitude range) leaves ~1e-13 deg of float noise --
 * astronomically meaningless (the ephemeris itself only claims ~1 arcminute)
 * but enough to land just on the wrong side of a mod-30 boundary.
 */
function roundDeg(longitude: number): number {
  return norm360(Math.round(longitude * 1e9) / 1e9);
}

function resolvedLocationOutput(ctx: Ctx) {
  return {
    place: ctx.placeName,
    longitude: ctx.loc.longitude,
    latitude: ctx.loc.latitude,
    timezone: ctx.timezone,
  };
}

/** Matches aspects present at BOTH endpoints of a time span (spec 4.3 mode B/C): the
 * only "aspect held throughout" claim honest enough to make without an exact time. */
function aspectsOverRange(pos0: AspectPosition[], pos1: AspectPosition[], ctx: Ctx) {
  const opts = {
    minorAspects: ctx.minorAspects, declinationAspects: ctx.declinationAspects, orbs: ctx.orbs,
    southNodeAspects: ctx.southNodeAspects,
  };
  const a0 = computeAspects(pos0, opts);
  const a1 = computeAspects(pos1, opts);
  const key = (a: { body1: string; body2: string; aspect: string }) => `${a.body1}|${a.body2}|${a.aspect}`;
  const map1 = new Map(a1.map((a) => [key(a), a]));
  const out: { body1: string; body2: string; aspect: string; orbRange: [number, number] }[] = [];
  for (const a of a0) {
    const b = map1.get(key(a));
    if (!b) continue;
    out.push({ body1: a.body1, body2: a.body2, aspect: aspectName(a.aspect, ctx.lang), orbRange: [a.orb, b.orb] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mode A: exact clock time
// ---------------------------------------------------------------------------

function computeExact(input: AstroInput, ctx: Ctx): AstroChart {
  const { hour, minute } = input.clockTime!;
  const utc = wallToUtc(ctx.year, ctx.month, ctx.day, hour, minute, ctx.timezone, input.dstFold ?? 0);

  const { ascendant: rawAsc, midheaven: rawMc, houses: rawHouses, degenerate: ascendantDegenerate } =
    anglesAndHousesAt(utc, ctx.loc, ctx.houseSystem, ctx.zodiac);
  const displayCusps = rawHouses.cusps.map((c) => roundDeg(toZodiac(c, ctx.zodiac, utc)));
  const displayAsc = toZodiac(rawAsc, ctx.zodiac, utc);
  const displayMc = toZodiac(rawMc, ctx.zodiac, utc);

  const positions: Record<string, unknown>[] = [];
  const aspectPositions: AspectPosition[] = [];
  let sunRaw: RawPos | undefined;
  let moonRaw: RawPos | undefined;

  const pushPosition = (internalName: string, raw: RawPos) => {
    const disp = toZodiac(raw.lon, ctx.zodiac, utc);
    const displayName = bodyName(internalName, ctx.lang);
    // Dignity is judged against the DISPLAYED sign, not the raw tropical one
    // -- otherwise a sidereal chart can show e.g. "Venus, Aries: Domicile"
    // while Venus is actually in sidereal Taurus, contradicting itself.
    const dignity = dignityOf(internalName, disp);
    positions.push({
      body: displayName,
      sign: signOfLongitude(disp, ctx.lang),
      degree: formatDegree(disp),
      longitude: disp,
      latitude: raw.lat,
      declination: raw.dec,
      house: houseOfLongitude(raw.lon, rawHouses.cusps),
      retrograde: raw.speed < 0,
      speed: raw.speed,
      dignity: dignityDisplay(dignity.kind, ctx.lang),
      dignityModern: dignity.modern,
    });
    aspectPositions.push({ body: displayName, lon: raw.lon, dec: raw.dec, speed: raw.speed, id: internalName });
  };

  for (const name of ctx.bodies) {
    const raw = rawBodyPosition(name, utc);
    pushPosition(name, raw);
    if (name === 'Sun') sunRaw = raw;
    if (name === 'Moon') moonRaw = raw;
  }
  for (const point of POINTS) {
    const raw = pointPosition(point, utc, { node: ctx.node, lilith: ctx.lilithKind });
    pushPosition(point, raw);
  }

  const aspects = computeAspects(aspectPositions, {
    minorAspects: ctx.minorAspects,
    declinationAspects: ctx.declinationAspects,
    orbs: ctx.orbs,
    southNodeAspects: ctx.southNodeAspects,
  }).map((a) => ({ ...a, aspect: aspectName(a.aspect, ctx.lang) }));

  // Day/night (sect) for the Part of Fortune is a PHYSICAL fact -- was the
  // Sun above the horizon -- and must not depend on which house system the
  // caller asked to display (Placidus vs whole-sign disagree on where a body
  // falls, but never on which side of the Asc/Dsc axis it's on). Houses 7-12
  // (the DSC-MC-ASC half) rotate the same way as an Ascendant-anchored equal
  // division always does, regardless of the display house system, so a
  // forward arc from the raw Ascendant gives the same answer independent of
  // ctx.houseSystem.
  const dayChart = fwdArc(rawAsc, sunRaw!.lon) >= 180;
  const pofRaw = norm360(
    rawAsc + (dayChart ? moonRaw!.lon - sunRaw!.lon : sunRaw!.lon - moonRaw!.lon)
  );
  const pofDisplay = toZodiac(pofRaw, ctx.zodiac, utc);

  return {
    birth: {
      solarDate: input.solarDate,
      clockTime: input.clockTime,
      utc: utc.toISOString(),
      resolvedLocation: resolvedLocationOutput(ctx),
    },
    highlights: {
      sunSign: signOfLongitude(toZodiac(sunRaw!.lon, ctx.zodiac, utc), ctx.lang),
      moonSign: signOfLongitude(toZodiac(moonRaw!.lon, ctx.zodiac, utc), ctx.lang),
      ascendantSign: signOfLongitude(displayAsc, ctx.lang),
    },
    angles: {
      ascendant: { longitude: displayAsc, sign: signOfLongitude(displayAsc, ctx.lang), degree: formatDegree(displayAsc) },
      midheaven: { longitude: displayMc, sign: signOfLongitude(displayMc, ctx.lang), degree: formatDegree(displayMc) },
    },
    positions,
    houses: { system: ctx.houseSystem, cusps: displayCusps, note: rawHouses.note },
    aspects,
    partOfFortune: {
      longitude: pofDisplay,
      sign: signOfLongitude(pofDisplay, ctx.lang),
      degree: formatDegree(pofDisplay),
      house: houseOfLongitude(pofRaw, rawHouses.cusps),
      dayChart,
    },
    diagnostics: {
      timePrecision: 'exact',
      ...ctx.diagnosticsBase,
      houseSystemFallback: rawHouses.note ?? null,
      ayanamsa: ayanamsa(ctx.zodiac, utc),
      ascendantDegenerate,
      omitted: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Mode B: a clock-time window
// ---------------------------------------------------------------------------

type AngleFn = (ms: number) => number;

/** Nudges `raw` by whole turns so it sits within 180 deg of `prev`, keeping an assumed-monotonic series continuous across the 360/0 wrap. */
function unwrapNear(prev: number, raw: number): number {
  let v = raw;
  while (v < prev - 180) v += 360;
  while (v > prev + 180) v -= 360;
  return v;
}

function bisectOneBoundary(
  msA: number,
  degA: number,
  msB: number,
  target: number,
  angleFn: AngleFn
): number {
  let lo = msA;
  let hi = msB;
  let loDeg = degA;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const deg = unwrapNear(loDeg, angleFn(mid));
    if (deg < target) {
      lo = mid;
      loDeg = deg;
    } else {
      hi = mid;
    }
  }
  return Math.round((lo + hi) / 2);
}

/** Coarse-sample an assumed-monotonic angle and bisect every 30-degree (sign) crossing to sub-minute precision. Spec 4.3: valid only where the Ascendant is proven monotonic (|lat| <= 66), and unconditionally for the Midheaven. */
function bisectSignBoundaries(t0: number, t1: number, angleFn: AngleFn): number[] {
  const STEP_MS = 2 * 60_000; // finer than the steepest monotonic case measured (66 deg, spec 4.3)
  const boundaries: number[] = [];
  let prevMs = t0;
  let prevDeg = angleFn(t0);
  for (let ms = t0 + STEP_MS; ; ms += STEP_MS) {
    const clamped = Math.min(ms, t1);
    const nextDeg = unwrapNear(prevDeg, angleFn(clamped));
    const k0 = Math.floor(prevDeg / 30);
    const k1 = Math.floor(nextDeg / 30);
    for (let k = k0 + 1; k <= k1; k++) {
      boundaries.push(bisectOneBoundary(prevMs, prevDeg, clamped, k * 30, angleFn));
    }
    prevMs = clamped;
    prevDeg = nextDeg;
    if (clamped >= t1) break;
  }
  return boundaries;
}

interface SignSegment {
  signIndex: number;
  fromMs: number;
  toMs: number;
}

function segmentsFromBoundaries(t0: number, t1: number, boundaries: number[], angleFn: AngleFn): SignSegment[] {
  const pts = [t0, ...boundaries, t1].sort((a, b) => a - b);
  const segs: SignSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b <= a) continue;
    segs.push({ signIndex: signIndexOf(angleFn((a + b) / 2)), fromMs: a, toMs: b });
  }
  return segs;
}

/** Last-resort path above the polar circle (spec 4.3/5.2): the Ascendant is
 * not monotonic there (measured: 132 reversals/day at 70N), so bisection
 * would silently mislabel candidates. This groups every <=30s sample into
 * contiguous same-sign runs instead of assuming a handful of crossings.
 * ponytail: exact sub-second crossing times aren't refined further here --
 * fine for the degenerate/rare polar case this exists for; tighten the step
 * if a caller ever needs sub-30s resolution at these latitudes. */
function scanSignRuns(t0: number, t1: number, angleFn: AngleFn): SignSegment[] {
  const STEP_MS = 30_000; // spec 4.3: <=30s steps above the polar circle
  const segs: SignSegment[] = [];
  for (let ms = t0; ; ms += STEP_MS) {
    const clamped = Math.min(ms, t1);
    const signIndex = signIndexOf(angleFn(clamped));
    const last = segs[segs.length - 1];
    if (last && last.signIndex === signIndex) last.toMs = clamped;
    else segs.push({ signIndex, fromMs: clamped, toMs: clamped });
    if (clamped >= t1) break;
  }
  return segs;
}

function candidateList(segs: SignSegment[], lang: Lang, timezone: string) {
  return segs.map((s) => ({
    sign: signNameByIndex(s.signIndex, lang),
    from: formatLocalTime(s.fromMs, timezone),
    to: formatLocalTime(s.toMs, timezone),
  }));
}

/**
 * House numbers sweep backward (mod 12) as time advances within a fixed
 * house system (the wheel rotates forward under a body that barely moves).
 * "Candidates" promises an enumeration, so list every house between the two
 * endpoints rather than just the two of them -- a several-hour window can
 * cross more than one house boundary.
 */
/**
 * Houses a body passes through between the two window endpoints.
 *
 * House numbers decrease as the cusps rotate forward in time (mod 12), so
 * walking house0 down to house1 enumerates the span. `fullTurn` covers the
 * case where the window is long enough that the cusps come all the way back
 * around: no house spans 180 deg, so equal endpoints plus more than half a
 * turn of sweep means every house was crossed.
 */
export function houseRangeCandidates(house0: number, house1: number, fullTurn = false): number[] {
  if (fullTurn) return Array.from({ length: 12 }, (_, i) => i + 1);
  const out: number[] = [house0];
  let h = house0;
  for (let i = 0; i < 12 && h !== house1; i++) {
    h = h === 1 ? 12 : h - 1;
    out.push(h);
  }
  return out;
}

function computeRange(input: AstroInput, ctx: Ctx): AstroChart {
  const range = input.clockTimeRange!;
  const fromMin = range.from.hour * 60 + range.from.minute;
  const toMin = range.to.hour * 60 + range.to.minute;
  if (fromMin === toMin) {
    throw new Error('clockTimeRange.from and .to are identical -- a zero-width window has no candidates to report.');
  }
  const crossesMidnight = fromMin > toMin;
  // Cusps make one full turn per sidereal day. A window spanning more than
  // half a day sweeps more than half a turn, so if the start and end houses
  // still coincide the body must have gone all the way around.
  const spanMin = crossesMidnight ? 1440 - fromMin + toMin : toMin - fromMin;
  const sweepsFullTurn = spanMin > 720;
  const fold = input.dstFold ?? 0;
  // Endpoints bound elapsed real time rather than assert an instant of birth,
  // so a wall-clock time skipped by a spring-forward is clamped to the gap
  // edge instead of rejected -- the same reasoning date-only mode applies to
  // its midnight boundaries. An exact `clockTime` still errors, because there
  // the caller IS asserting a specific instant.
  const from0 = wallToUtcOrGapEdge(ctx.year, ctx.month, ctx.day, range.from.hour, range.from.minute, ctx.timezone, fold);
  const t0 = from0.getTime();
  const to1 = wallToUtcOrGapEdge(
    ctx.year,
    ctx.month,
    ctx.day + (crossesMidnight ? 1 : 0),
    range.to.hour,
    range.to.minute,
    ctx.timezone,
    fold
  );
  const t1 = to1.getTime();
  // Disclose rather than refuse: an endpoint the local clock skipped was moved
  // to the edge of the gap. The caller told us the window was fuzzy, so this
  // is not worth an error -- but it is worth saying out loud.
  const gapClamped = Boolean(from0.clamped || to1.clamped);

  // Candidate segmentation must run on the DISPLAY (zodiac-converted) angle,
  // not the raw tropical one -- otherwise every candidate sign in a sidereal
  // chart is silently shifted by a whole ayanamsa (~24 deg).
  const ascAngleFn: AngleFn = (ms) => toZodiac(computeAngles(new Date(ms), ctx.loc).ascendant, ctx.zodiac, new Date(ms));
  const mcAngleFn: AngleFn = (ms) => toZodiac(computeAngles(new Date(ms), ctx.loc).midheaven, ctx.zodiac, new Date(ms));

  // Spec 4.3: strictly monotonic only within the polar circle; scan instead beyond it.
  const ascendantMonotonic = Math.abs(ctx.loc.latitude) <= 66;
  const ascSegs = ascendantMonotonic
    ? segmentsFromBoundaries(t0, t1, bisectSignBoundaries(t0, t1, ascAngleFn), ascAngleFn)
    : scanSignRuns(t0, t1, ascAngleFn);
  const mcSegs = segmentsFromBoundaries(t0, t1, bisectSignBoundaries(t0, t1, mcAngleFn), mcAngleFn); // MC is monotonic at every latitude
  const method: 'bisect' | 'scan' = ascendantMonotonic ? 'bisect' : 'scan';

  const at0 = anglesAndHousesAt(new Date(t0), ctx.loc, ctx.houseSystem, ctx.zodiac);
  const at1 = anglesAndHousesAt(new Date(t1), ctx.loc, ctx.houseSystem, ctx.zodiac);

  const positions: Record<string, unknown>[] = [];
  const aspects0: AspectPosition[] = [];
  const aspects1: AspectPosition[] = [];
  let sunSign0 = '';
  let sunSign1 = '';
  let moonSign0 = '';
  let moonSign1 = '';

  const posAt = (name: string, ms: number): RawPos =>
    (POINTS as readonly string[]).includes(name)
      ? pointPosition(name as PointName, new Date(ms), { node: ctx.node, lilith: ctx.lilithKind })
      : rawBodyPosition(name, new Date(ms));

  // Nodes/Lilith are pure functions of time (no ephemeris lookup to degrade),
  // so there is no reason to omit them here the way the Ascendant-derived
  // fields are omitted -- evaluate them at both endpoints just like the bodies.
  for (const name of [...ctx.bodies, ...POINTS]) {
    const raw0 = posAt(name, t0);
    const raw1 = posAt(name, t1);
    const disp0 = toZodiac(raw0.lon, ctx.zodiac, new Date(t0));
    const disp1 = toZodiac(raw1.lon, ctx.zodiac, new Date(t1));
    const sign0 = signOfLongitude(disp0, ctx.lang);
    const sign1 = signOfLongitude(disp1, ctx.lang);
    const displayName = bodyName(name, ctx.lang);
    const house0 = houseOfLongitude(raw0.lon, at0.houses.cusps);
    const house1 = houseOfLongitude(raw1.lon, at1.houses.cusps);

    positions.push({
      body: displayName,
      ...(sign0 === sign1 ? { sign: sign0 } : { signCandidates: [sign0, sign1] }),
      degreeRange: [formatDegree(disp0), formatDegree(disp1)],
      houseCandidates: houseRangeCandidates(house0, house1, sweepsFullTurn && house0 === house1),
    });

    aspects0.push({ body: displayName, lon: raw0.lon, dec: raw0.dec, speed: raw0.speed, id: name });
    aspects1.push({ body: displayName, lon: raw1.lon, dec: raw1.dec, speed: raw1.speed, id: name });
    if (name === 'Sun') {
      sunSign0 = sign0;
      sunSign1 = sign1;
    }
    if (name === 'Moon') {
      moonSign0 = sign0;
      moonSign1 = sign1;
    }
  }

  return {
    birth: {
      solarDate: input.solarDate,
      clockTimeRange: input.clockTimeRange,
      resolvedLocation: resolvedLocationOutput(ctx),
    },
    highlights: {
      ...(sunSign0 === sunSign1 ? { sunSign: sunSign0 } : { sunSignCandidates: [sunSign0, sunSign1] }),
      ...(moonSign0 === moonSign1 ? { moonSign: moonSign0 } : { moonSignCandidates: [moonSign0, moonSign1] }),
      ascendantSignCandidates: candidateList(ascSegs, ctx.lang, ctx.timezone),
    },
    angles: {
      ascendant: { candidates: candidateList(ascSegs, ctx.lang, ctx.timezone) },
      midheaven: { candidates: candidateList(mcSegs, ctx.lang, ctx.timezone) },
    },
    positions,
    houses: { system: ctx.houseSystem, cuspsIndeterminate: true },
    aspects: aspectsOverRange(aspects0, aspects1, ctx),
    diagnostics: {
      timePrecision: 'range',
      method,
      ascendantMonotonic,
      range: {
        from: formatLocalTime(t0, ctx.timezone),
        to: formatLocalTime(t1, ctx.timezone),
        crossesMidnight,
      },
      ...ctx.diagnosticsBase,
      houseSystemFallback: at0.houses.note ?? at1.houses.note ?? null,
      ayanamsa: ayanamsa(ctx.zodiac, new Date(t0)),
      ...(gapClamped ? {
        note: 'One or both ends of clockTimeRange fell in an hour the local '
          + 'clock skipped for daylight saving; the window was clamped to the '
          + 'edge of that gap.',
      } : {}),
      omitted: ['partOfFortune', 'aspects[].applying'].map((field) => ({
        field,
        reason: omissionReason(field, ctx.lang),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Mode C: date only
// ---------------------------------------------------------------------------

function computeDateOnly(input: AstroInput, ctx: Ctx): AstroChart {
  // The user gave no time at all here -- these midnight boundaries only exist
  // to bound the day's sampling window (spec 4.3), so a timezone whose next
  // midnight happens to fall in a DST spring-forward gap (e.g. Santiago) must
  // not surface as an error about a time nobody typed.
  const t0 = wallToUtcOrGapEdge(ctx.year, ctx.month, ctx.day, 0, 0, ctx.timezone).getTime();
  const t1 = wallToUtcOrGapEdge(ctx.year, ctx.month, ctx.day + 1, 0, 0, ctx.timezone).getTime();

  const positions: Record<string, unknown>[] = [];
  const aspects0: AspectPosition[] = [];
  const aspects1: AspectPosition[] = [];
  let sunSign0 = '';
  let sunSign1 = '';
  let moonSign0 = '';
  let moonSign1 = '';

  const pushRangedPosition = (internalName: string, raw0: RawPos, raw1: RawPos) => {
    const disp0 = toZodiac(raw0.lon, ctx.zodiac, new Date(t0));
    const disp1 = toZodiac(raw1.lon, ctx.zodiac, new Date(t1));
    const sign0 = signOfLongitude(disp0, ctx.lang);
    const sign1 = signOfLongitude(disp1, ctx.lang);
    const displayName = bodyName(internalName, ctx.lang);
    positions.push({
      body: displayName,
      ...(sign0 === sign1 ? { sign: sign0 } : { signCandidates: [sign0, sign1] }),
      degreeRange: [formatDegree(disp0), formatDegree(disp1)],
    });
    aspects0.push({ body: displayName, lon: raw0.lon, dec: raw0.dec, speed: raw0.speed, id: internalName });
    aspects1.push({ body: displayName, lon: raw1.lon, dec: raw1.dec, speed: raw1.speed, id: internalName });
    return { sign0, sign1 };
  };

  for (const name of ctx.bodies) {
    const raw0 = rawBodyPosition(name, new Date(t0));
    const raw1 = rawBodyPosition(name, new Date(t1));
    const { sign0, sign1 } = pushRangedPosition(name, raw0, raw1);
    if (name === 'Sun') {
      sunSign0 = sign0;
      sunSign1 = sign1;
    }
    if (name === 'Moon') {
      moonSign0 = sign0;
      moonSign1 = sign1;
    }
  }
  for (const point of POINTS) {
    const raw0 = pointPosition(point, new Date(t0), { node: ctx.node, lilith: ctx.lilithKind });
    const raw1 = pointPosition(point, new Date(t1), { node: ctx.node, lilith: ctx.lilithKind });
    pushRangedPosition(point, raw0, raw1);
  }

  const omitted = ['angles', 'houses', 'positions[].house', 'partOfFortune', 'aspects[].applying'].map((field) => ({
    field,
    reason: omissionReason(field, ctx.lang),
  }));

  return {
    birth: {
      solarDate: input.solarDate,
      resolvedLocation: resolvedLocationOutput(ctx),
    },
    highlights: {
      ...(sunSign0 === sunSign1 ? { sunSign: sunSign0 } : { sunSignCandidates: [sunSign0, sunSign1] }),
      ...(moonSign0 === moonSign1 ? { moonSign: moonSign0 } : { moonSignCandidates: [moonSign0, moonSign1] }),
    },
    positions,
    aspects: aspectsOverRange(aspects0, aspects1, ctx),
    diagnostics: {
      timePrecision: 'date_only',
      ...ctx.diagnosticsBase,
      houseSystemFallback: null,
      ayanamsa: ayanamsa(ctx.zodiac, new Date(t0)),
      omitted,
    },
  };
}

// ---------------------------------------------------------------------------

export function computeChart(input: AstroInput): AstroChart {
  const ctx = buildCtx(input);
  if (input.clockTime) return computeExact(input, ctx);
  if (input.clockTimeRange) return computeRange(input, ctx);
  return computeDateOnly(input, ctx);
}
