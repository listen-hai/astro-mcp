/**
 * Retrograde-period search (v2): "when is Mercury retrograde" needs no birth
 * data at all, just a body and a calendar window -- the one v2 tool with
 * nothing to degrade (spec soul, task brief).
 *
 * Method: coarse daily sampling of `bodySpeed` (already signed: negative =
 * retrograde) across the window, bisecting every sign flip down to the exact
 * station instant -- the same coarse-scan-then-bisect shape chart.ts already
 * uses for Ascendant sign boundaries (bisectOneBoundary/bisectSignBoundaries),
 * just applied to the sign of a derivative instead of the value of an angle.
 */
import { bodyLongitude, bodySpeed } from '../ephemeris/engine';
import { signIndexOf, signNameByIndex, type Lang } from './i18n';

const MS_PER_DAY = 86_400_000;
const MAX_WINDOW_YEARS = 5;
const MAX_WINDOW_MS = MAX_WINDOW_YEARS * 365.25 * MS_PER_DAY;
const STEP_MS = MS_PER_DAY;
// Wide enough to find the true station bracketing the window even when the
// window itself opens or closes mid-retrograde: the longest retrograde among
// the supported bodies (outer planets, spec: "once a year, for months at a
// time") runs well under 200 days.
const PAD_MS = 200 * MS_PER_DAY;

/** Bodies `bodySpeed` (src/ephemeris/engine.ts) actually has an ephemeris for. */
const RETROGRADE_BODIES = [
  'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
] as const;
export type RetrogradeBody = (typeof RETROGRADE_BODIES)[number] | 'Sun' | 'Moon';

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export interface RetrogradeInput {
  body: RetrogradeBody | string;
  from: CalendarDate;
  to: CalendarDate;
  lang?: Lang;
}

export interface RetrogradePeriod {
  startsUtc: string;
  endsUtc: string;
  startSign: string;
}

export interface RetrogradeResult {
  body: string;
  periods: RetrogradePeriod[];
}

function dateMs(d: CalendarDate): number {
  return Date.UTC(d.year, d.month - 1, d.day);
}

/** Bisects a sign flip in `bodySpeed` between `loMs` (sign known) and `hiMs` (opposite sign) to the station instant. */
function bisectStation(body: string, loMs: number, hiMs: number): number {
  let lo = loMs;
  let hi = hiMs;
  const loSign = Math.sign(bodySpeed(body, new Date(lo)));
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(bodySpeed(body, new Date(mid))) === loSign) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

interface Station {
  ms: number;
  toRetrograde: boolean; // true = station-retrograde (direct -> retrograde), false = station-direct
}

/** Every station (direction change) found in [scanFromMs, scanToMs], daily-sampled and bisected to the instant. */
function findStations(body: string, scanFromMs: number, scanToMs: number): Station[] {
  const stations: Station[] = [];
  let prevMs = scanFromMs;
  let prevSpeed = bodySpeed(body, new Date(prevMs));
  for (let ms = scanFromMs + STEP_MS; ; ms += STEP_MS) {
    const clamped = Math.min(ms, scanToMs);
    const speed = bodySpeed(body, new Date(clamped));
    if ((prevSpeed < 0) !== (speed < 0)) {
      const stationMs = bisectStation(body, prevMs, clamped);
      stations.push({ ms: stationMs, toRetrograde: speed < 0 });
    }
    prevMs = clamped;
    prevSpeed = speed;
    if (clamped >= scanToMs) break;
  }
  return stations;
}

export function findRetrograde(input: RetrogradeInput): RetrogradeResult {
  const lang = input.lang ?? 'zh';

  if (input.body === 'Sun' || input.body === 'Moon') {
    throw new Error(
      `${input.body} never retrograde (apparent retrograde motion is an artifact of viewing an `
      + 'inferior/superior planet from a moving Earth; the Sun and Moon have no such effect). '
      + 'Refusing rather than returning an empty period list, which would look like "no '
      + 'retrograde in this window" instead of "this concept does not apply here".'
    );
  }
  if (!(RETROGRADE_BODIES as readonly string[]).includes(input.body)) {
    throw new Error(`Unknown or unsupported body for retrograde search: "${input.body}".`);
  }

  const fromMs = dateMs(input.from);
  const toMs = dateMs(input.to);
  if (toMs <= fromMs) {
    throw new Error('`to` must be after `from`.');
  }
  if (toMs - fromMs > MAX_WINDOW_MS) {
    throw new Error(
      `Requested window (${((toMs - fromMs) / MS_PER_DAY / 365.25).toFixed(1)} years) exceeds the `
      + `${MAX_WINDOW_YEARS}-year limit for a retrograde search -- a wider range would take too `
      + 'long to scan. Split it into smaller windows instead.'
    );
  }

  const stations = findStations(input.body, fromMs - PAD_MS, toMs + PAD_MS);

  const periods: RetrogradePeriod[] = [];
  for (let i = 0; i < stations.length; i++) {
    if (!stations[i].toRetrograde) continue;
    const next = stations[i + 1];
    // An unpaired station-retrograde (padding exhausted before the matching
    // station-direct was found) is skipped rather than given a fabricated end.
    if (!next || next.toRetrograde) continue;
    const startMs = stations[i].ms;
    const endMs = next.ms;
    if (endMs <= fromMs || startMs >= toMs) continue; // entirely outside the requested window
    periods.push({
      startsUtc: new Date(startMs).toISOString(),
      endsUtc: new Date(endMs).toISOString(),
      startSign: signNameByIndex(signIndexOf(bodyLongitude(input.body, new Date(startMs))), lang),
    });
  }

  return { body: input.body, periods };
}
