/**
 * Wall-clock time -> UTC instant, DST-safe.
 *
 * Adapted from ziwei's `core/time.ts` gap/fold handling; the true-solar-time
 * correction that ziwei/bazi need has been dropped entirely (see spec 4.2 --
 * Western astrology's houses are driven by sidereal time, which already bakes
 * in longitude, so a second longitude correction would double-count it).
 */

/** What the given UTC instant reads as wall-clock time in `timeZone`, expressed as if it were UTC ms. */
function wallClockAt(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  return Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
}

/**
 * Converts a wall-clock birth time in an IANA timezone to the UTC instant.
 *
 * - Spring-forward gap (the wall time never occurred): throws.
 * - Fall-back repeated hour: `fold` disambiguates (0 = first occurrence / DST,
 *   1 = second occurrence / standard time).
 */
// Wider than any DST shift (typically 1-2h) and than any UTC offset (max ~14h),
// so sampling this far on either side of the target always lands clear of the
// transition itself and picks up the "before" and "after" offset in force.
const BRACKET_MS = 25 * 3600 * 1000;

export function wallToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string,
  fold: 0 | 1 = 0
): Date {
  const wall = Date.UTC(y, mo - 1, d, h, mi, 0);

  // Sample the offset well before and well after `wall` rather than iterating
  // to a single fixed point -- a fixed-point iteration converges to whichever
  // offset it started nearest to and can miss the *other* valid candidate
  // during a fall-back repeated hour.
  const offBefore = wallClockAt(wall - BRACKET_MS, timeZone) - (wall - BRACKET_MS);
  const offAfter = wallClockAt(wall + BRACKET_MS, timeZone) - (wall + BRACKET_MS);
  const candidates = new Set([wall - offBefore, wall - offAfter]);

  const valid = [...candidates].filter((c) => wallClockAt(c, timeZone) === wall);
  const uniq = [...new Set(valid)].sort((a, b) => a - b);

  if (uniq.length === 0) {
    const pad = (n: number) => String(n).padStart(2, '0');
    throw new Error(
      `Wall-clock time ${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)} does not exist in ${timeZone} ` +
        `(skipped by a daylight-saving spring-forward). Provide a time outside the gap.`
    );
  }
  if (uniq.length === 1) return new Date(uniq[0]);
  return new Date(uniq[fold]); // repeated hour: 0 = first occurrence (DST), 1 = second (standard time)
}
