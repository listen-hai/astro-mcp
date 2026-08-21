/**
 * Ascendant and Midheaven (the four angles' longitude-bearing pair).
 *
 * This module is original to this project -- not vendored from auseklis.
 * auseklis's Ascendant formula is a bare atan2 with no east-horizon
 * correction; see the note on the east-horizon convention below for why
 * that breaks above the polar circle (spec 5.2).
 */
import * as AstronomyImport from 'astronomy-engine';
import { norm360, D2R, R2D, obliquity } from './frames';
import type { Location } from '../types';

const A = ((AstronomyImport as unknown as { default?: typeof AstronomyImport }).default ??
  AstronomyImport) as typeof AstronomyImport;

export interface Angles {
  ascendant: number;
  midheaven: number;
  degenerate: boolean;
}

export function computeAngles(date: Date, loc: Location): Angles {
  const t = A.MakeTime(date);
  const eps = obliquity(t) * D2R;
  const ramc = norm360(A.SiderealTime(t) * 15 + loc.longitude); // local sidereal time, in degrees
  const phi = loc.latitude * D2R;

  const midheaven = norm360(
    Math.atan2(Math.tan(ramc * D2R), Math.cos(eps)) * R2D +
      (Math.cos(ramc * D2R) < 0 ? 180 : 0)
  );

  const denom = Math.sin(ramc * D2R) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps);
  let ascendant = norm360(Math.atan2(Math.cos(ramc * D2R), -denom) * R2D);

  // East-horizon correction (spec 5.2): the bare atan2 formula above returns
  // the DESCENDANT for part of the day above the polar circle. Convention:
  // the Ascendant must lie on the eastern half-circle from the MC. Without
  // this, tests/invariant.test.ts "the Ascendant stays on the eastern half
  // from the MC" fails at 70N and 78N.
  if (norm360(ascendant - midheaven) > 180) ascendant = norm360(ascendant + 180);

  // Degenerate above the true polar circle for this date's obliquity (not a
  // fixed 66.56 constant -- obliquity drifts slowly). The previous check
  // additionally required the instantaneous denominator to be ~0, which only
  // happens for a few seconds a day and was unreachable in practice; the
  // Ascendant is unreliable (near-stationary, see the east-horizon note
  // above) for the whole time the observer is beyond the polar circle, not
  // just at that instant.
  const degenerate = Math.abs(loc.latitude) > 90 - eps * R2D;

  return { ascendant, midheaven, degenerate };
}
