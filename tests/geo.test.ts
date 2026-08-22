import { expect, test } from 'bun:test';
import { lookupCity, lookupCityWithCount, resolveLocation } from '../src/geo/resolver';

// Tolerance is 0.3 deg: the city-timezones DB stores a municipal centroid, not the
// landmark coordinate people quote. 0.3 deg of latitude shifts the Ascendant by well
// under a degree at mid-latitudes, which is inside the noise of a `place` lookup --
// callers wanting exactness pass explicit longitude/latitude instead.
const NEAR = 0.3;

test('city lookup returns latitude -- required for charts, absent in ziwei/bazi', () => {
  const [la] = lookupCity('Los Angeles');
  expect(Math.abs(la.latitude - 34.05)).toBeLessThan(NEAR);
  expect(Math.abs(la.longitude - -118.24)).toBeLessThan(NEAR);
  expect(la.timezone).toBe('America/Los_Angeles');
});

test('Chinese cities resolve to the single nationwide civil zone', () => {
  const [bj] = lookupCity('Beijing');
  expect(bj.timezone).toBe('Asia/Shanghai');
  expect(Math.abs(bj.latitude - 39.90)).toBeLessThan(NEAR);
});

test('southern-hemisphere cities carry a negative latitude', () => {
  const [syd] = lookupCity('Sydney');
  expect(syd.latitude).toBeLessThan(0);
  expect(Math.abs(syd.latitude - -33.87)).toBeLessThan(NEAR);
});

test('above the Arctic Circle resolves (polar handling is exercised downstream)', () => {
  const [tromso] = lookupCity('Tromso');
  expect(tromso.latitude).toBeGreaterThan(66.56);
  // NOT a bug: since tzdata 2022b the IANA project merged Europe/Oslo, /Stockholm and
  // /Copenhagen into links pointing at Europe/Berlin (identical CET/CEST rules since
  // 1970). geo-tz returns the canonical zone. Do not "fix" this to Europe/Oslo --
  // both names resolve to the same offsets, and Berlin is the canonical one.
  expect(['Europe/Berlin', 'Europe/Oslo']).toContain(tromso.timezone);
});

test('unknown city yields no match rather than a wrong one', () => {
  expect(lookupCity('Nowherecityxyz')).toHaveLength(0);
});

// ------------------------------------------------------------- never guess

test('same-name cities in one timezone but different places are REFUSED', () => {
  // Columbus OH (40.0N) and Columbus GA (32.5N) share America/New_York, so an
  // earlier "same timezone means no chart impact" shortcut picked one
  // silently. It is wrong for every sibling: 7.5 deg of latitude moves the
  // Ascendant outright, and the 2 deg of longitude between them is 8 minutes
  // of true solar time, enough to cross a Bazi hour-pillar boundary.
  expect(() => resolveLocation({ place: 'Columbus' })).toThrow(/multiple candidate/i);
});

test('same-name entries at the SAME point still resolve -- that is a fact, not a guess', () => {
  // Kansas City MO and Kansas City KS are adjacent and carry identical
  // coordinates in the dataset. Refusing there would be pedantry: there is no
  // ambiguity about where the birth happened.
  const kc = resolveLocation({ place: 'Kansas City' });
  expect(kc.timezone).toBe('America/Chicago');
});

test('the refusal carries no likelihood hint -- asking must stay neutral', () => {
  // Population is a prior, not identifying information, and it is the exact
  // signal behind the auto-pick that used to live here. Listing it would move
  // the guess from our code into the agent's prompt: "Ohio, right?" instead
  // of "Ohio or Georgia?".
  let msg = '';
  try { resolveLocation({ place: 'Columbus' }); } catch (e) { msg = (e as Error).message; }
  expect(msg).not.toMatch(/population/i);
  expect(msg).toMatch(/Ohio/);
  expect(msg).toMatch(/Georgia/);
});

test('the refusal tells an agent how to resolve it in one turn', () => {
  // The caller is an AI agent that can ask the user. A refusal is only
  // acceptable if it carries what the agent needs to ask a good question.
  let msg = '';
  try { resolveLocation({ place: 'San Jose' }); } catch (e) { msg = (e as Error).message; }
  expect(msg).toMatch(/ask which one/i);
  expect(msg).toMatch(/California/);       // province: how a person recognises their own city
  expect(msg).toMatch(/latitude/);
  expect(msg).toMatch(/longitude/);
  expect(msg).toMatch(/timezone/);
});

test('no place name is ever resolved by picking the biggest candidate', () => {
  // Regression guard for the population-dominance rule that once auto-picked
  // Los Angeles (US) over Los Angeles (Chile) at a 60x margin. Overwhelming
  // odds are still odds.
  for (const place of ['Los Angeles', 'San Jose', 'Springfield', 'Columbus']) {
    expect(() => resolveLocation({ place })).toThrow();
  }
});

// ------------------------------------------------- truncation must be shown

test('a truncated candidate list says how many were left out', () => {
  // "Santa" partial-matches 37 cities. lookupCity keeps 10, the refusal
  // message showed 5, and neither said so -- the user's actual birthplace can
  // be among the 32 that vanished, dropped by popularity, silently. Cutting a
  // list for size is fine; not saying you cut it is a quiet lie about how
  // complete the answer is.
  let msg = '';
  try { resolveLocation({ place: 'Santa' }); } catch (e) { msg = (e as Error).message; }
  expect(msg).toMatch(/showing \d+ of \d+/i);
  expect(msg).toMatch(/37|more/i);
});

test('an untruncated list makes no claim about truncation', () => {
  let msg = '';
  try { resolveLocation({ place: 'San Jose' }); } catch (e) { msg = (e as Error).message; }
  expect(msg).not.toMatch(/showing \d+ of \d+/i);   // all 4 shown; nothing to disclose
});

test('lookupCity reports the true match count, not just what survived the cap', () => {
  const { matched, results } = lookupCityWithCount('Santa');
  expect(results.length).toBeLessThanOrEqual(10);
  expect(matched).toBeGreaterThan(30);
});

test('lookup results carry no population -- it is a prior, not an identifier', () => {
  // Deleting population from the refusal message but leaving it on the query
  // path just moves the prior: an agent following the recommended
  // lookup-first flow gets the ranking signal in full.
  for (const c of lookupCity('San Jose')) {
    expect('population' in c).toBe(false);
  }
});
