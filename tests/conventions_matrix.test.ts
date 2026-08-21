import { expect, test } from 'bun:test';
import { computeChart } from '../src/core/chart';

// The default combination (tropical + placidus + exact time) was well covered;
// every finding in this file lived in a NON-default combination. The matrix
// below is the coverage that was missing.

const AT = { solarDate: { year: 1990, month: 6, day: 15 }, place: 'Los Angeles' } as const;
const EXACT = { ...AT, clockTime: { hour: 20, minute: 0 } };
const RANGE = { ...AT, clockTimeRange: { from: { hour: 18, minute: 0 }, to: { hour: 23, minute: 59 } } };

const bodyIn = (c: never, name: string) =>
  (c as { positions: { body: string }[] }).positions.some((p) => p.body === name);

// ---------------------------------------------------------------- sidereal

test('sidereal: dignity is judged in the sidereal signs, not the tropical ones', () => {
  // Venus in sidereal Aries is in DETRIMENT (it rules Taurus and Libra).
  // Looking the dignity up on the tropical longitude while displaying the
  // sidereal sign produces output that contradicts itself on its face.
  const c = computeChart({ ...EXACT, zodiac: 'sidereal-lahiri', lang: 'en' } as never);
  for (const p of c.positions as { body: string; sign: string; dignity?: string }[]) {
    if (!p.dignity) continue;
    if (p.body === 'Venus' && p.sign === 'Aries') expect(p.dignity).toBe('Detriment');
    if (p.body === 'Mars' && p.sign === 'Pisces') expect(p.dignity).not.toBe('Domicile');
    if (p.body === 'Jupiter' && p.sign === 'Gemini') expect(p.dignity).not.toBe('Exaltation');
  }
});

test('sidereal: whole-sign cusps still land on exact sign boundaries', () => {
  const c = computeChart({ ...EXACT, zodiac: 'sidereal-lahiri', houseSystem: 'whole-sign' } as never);
  for (const cusp of c.houses.cusps) expect(cusp % 30).toBeCloseTo(0, 6);
});

test('sidereal + range mode: Ascendant candidates are sidereal signs', () => {
  // Segmenting on tropical longitudes shifts every candidate by one ayanamsa
  // (~24 deg) -- silently returning the wrong signs, the exact failure this
  // project exists to avoid.
  const range = computeChart({ ...RANGE, zodiac: 'sidereal-lahiri' } as never);
  const at2045 = computeChart({
    ...AT, clockTime: { hour: 20, minute: 45 }, zodiac: 'sidereal-lahiri',
  } as never);
  const signs = range.highlights.ascendantSignCandidates.map((s: { sign: string }) => s.sign);
  expect(signs).toContain(at2045.highlights.ascendantSign);
});

// ------------------------------------------------------------- whole-sign

test('the day/night sect is a physical fact and must not follow the house system', () => {
  // Sect decides the Part of Fortune formula. Deriving it from user-selected
  // cusps makes a physical fact (was the Sun above the horizon?) depend on a
  // display convention -- measured 163 deg of drift in the resulting Lot.
  const morning = { ...AT, clockTime: { hour: 6, minute: 0 } };
  const p = computeChart({ ...morning } as never);
  const w = computeChart({ ...morning, houseSystem: 'whole-sign' } as never);
  expect(p.partOfFortune.dayChart).toBe(w.partOfFortune.dayChart);
  expect(p.partOfFortune.longitude).toBeCloseTo(w.partOfFortune.longitude, 6);
});

test('dayChart is an actual boolean, never undefined', () => {
  for (const hour of [6, 12, 20, 23]) {
    const c = computeChart({ ...AT, clockTime: { hour, minute: 0 } } as never);
    expect(typeof c.partOfFortune.dayChart).toBe('boolean');
  }
  expect(computeChart({ ...AT, clockTime: { hour: 12, minute: 0 } } as never)
    .partOfFortune.dayChart).toBe(true);
  expect(computeChart({ ...AT, clockTime: { hour: 2, minute: 0 } } as never)
    .partOfFortune.dayChart).toBe(false);
});

// ------------------------------------------------------------- range mode

test('range mode keeps the nodes and Lilith -- they are plain functions of time', () => {
  const c = computeChart({ ...RANGE } as never);
  for (const name of ['北交点', '南交点', '莉莉丝']) expect(bodyIn(c as never, name)).toBe(true);
});

test('every omitted entry names a real field -- no nulls in the list', () => {
  for (const input of [{ ...AT }, { ...RANGE }]) {
    const c = computeChart(input as never);
    for (const o of c.diagnostics.omitted) {
      expect(typeof o.field).toBe('string');
      expect(o.field.length).toBeGreaterThan(0);
    }
  }
});

test('house candidates are exhaustive, not just the two endpoints', () => {
  // Cusps sweep ~15 deg/hour, so a 6-hour window crosses intermediate houses.
  // "Candidates" promises an enumeration; skipping the middle misleads callers.
  const c = computeChart({ ...RANGE } as never);
  const sun = c.positions.find((p: { body: string }) => p.body === '太阳');
  const cands: number[] = sun.houseCandidates;
  const sampled = new Set<number>();
  for (let m = 0; m <= 359; m += 10) {
    const at = computeChart({
      ...AT, clockTime: { hour: 18 + Math.floor(m / 60), minute: m % 60 },
    } as never);
    sampled.add(at.positions.find((p: { body: string }) => p.body === '太阳').house);
  }
  for (const h of sampled) expect(cands).toContain(h);
});

test('a zero-width window is rejected rather than yielding an empty candidate list', () => {
  expect(() => computeChart({
    ...AT, clockTimeRange: { from: { hour: 20, minute: 0 }, to: { hour: 20, minute: 0 } },
  } as never)).toThrow();
});

// ------------------------------------------------------- fabricated inputs

test('a calendar date that does not exist is refused, not rolled forward', () => {
  // 1990-02-30 silently became 1990-03-03 while the echo still said Feb 30 --
  // a confident chart for a date nobody was born on.
  for (const d of [{ month: 2, day: 30 }, { month: 4, day: 31 }, { month: 2, day: 29 }]) {
    expect(() => computeChart({
      solarDate: { year: 1990, ...d }, clockTime: { hour: 20, minute: 0 }, place: 'Los Angeles',
    } as never)).toThrow(/does not exist|invalid date/i);
  }
  // ...but a real leap day is fine
  expect(() => computeChart({
    solarDate: { year: 1992, month: 2, day: 29 }, clockTime: { hour: 20, minute: 0 },
    place: 'Los Angeles',
  } as never)).not.toThrow();
});

test('date-only mode survives a timezone whose next midnight does not exist', () => {
  // Chile springs forward AT midnight, so the day-boundary the date-only mode
  // uses as its upper endpoint is a wall-clock time that does not exist. The
  // user supplied no time at all, so an error about a nonexistent 00:00 is
  // unrelated to anything they typed.
  //
  // Explicit coordinates, not place: 'Santiago' -- that name is genuinely
  // ambiguous (Chile 2.88M vs Santo Domingo 1.47M, only 1.96x apart, under
  // the 10x dominance threshold) and is correctly refused by the ambiguity
  // guard. Using the bare name here would test two unrelated things at once.
  expect(() => computeChart({
    solarDate: { year: 2026, month: 9, day: 5 },
    longitude: -70.65, latitude: -33.45, timezone: 'America/Santiago',
  } as never)).not.toThrow();
});

test('the ambiguity guard still refuses genuinely close namesakes', () => {
  // Guards the other half of the case above: loosening the dominance ratio to
  // make bare 'Santiago' resolve would gut the disclosure discipline.
  expect(() => computeChart({
    solarDate: { year: 2026, month: 9, day: 5 }, place: 'Santiago',
  } as never)).toThrow(/multiple candidate|specify more/i);
});

// ------------------------------------------------------------ axis aspects

test('REGRESSION: the nodes must not aspect each other', () => {
  // spec 2.1 mocks auseklis for emitting "North Node Parallel South Node orb 0".
  // The nodes are 180 deg apart by construction; an opposition between them
  // carries no information and is the same absurdity in a different coat.
  for (const opts of [{}, { declinationAspects: true }]) {
    const c = computeChart({ ...EXACT, ...opts } as never);
    const selfAxis = c.aspects.filter((a: { body1: string; body2: string }) =>
      (a.body1 === '北交点' && a.body2 === '南交点') || (a.body1 === '南交点' && a.body2 === '北交点'));
    expect(selfAxis).toHaveLength(0);
  }
});

// -------------------------------------------------------------- disclosure

test('a place that needed disambiguation says so in diagnostics', () => {
  // "Los Angeles" also names a town in Bio-Bio, Chile. Picking the larger one
  // is defensible; doing it without a word in the output is not.
  const c = computeChart({ ...EXACT } as never);
  expect(c.diagnostics.location).toBeDefined();
  expect(JSON.stringify(c.diagnostics.location)).toMatch(/Chile|CL|ambigu|dominan/i);
});

test('same-timezone namesakes differ in LATITUDE, which changes the chart', () => {
  // Columbus OH (40.0N) and Columbus GA (32.5N) share America/New_York. For
  // bazi that is genuinely harmless -- it only uses longitude. For a chart the
  // latitude drives the Ascendant, so silence is not acceptable here.
  const c = computeChart({
    solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 20, minute: 0 },
    place: 'Columbus',
  } as never);
  expect(JSON.stringify(c.diagnostics.location)).toMatch(/ambigu|candidate|alternate|dominan/i);
});

// ------------------------------------------------------------------ polar

test('spec 5.2: a degenerate Ascendant is reported, not silently returned', () => {
  // Polar night/day can leave the ecliptic entirely above or below the horizon.
  // The flag existed in angles.ts but was discarded before reaching the output.
  const c = computeChart({
    solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 12, minute: 0 },
    longitude: 15, latitude: 78, timezone: 'Europe/Berlin',
  } as never);
  expect('ascendantDegenerate' in c.diagnostics).toBe(true);
});

// -------------------------------------------------------------- i18n / doc

test('dignity reports whether it rests on a modern rulership', () => {
  // README promises the caller can tell classical dignities from modern
  // outer-planet ones. dignityOf() returns it; chart.ts was dropping it.
  const c = computeChart({ ...EXACT, lang: 'en' } as never);
  const withDignity = (c.positions as { dignity?: string; dignityModern?: boolean }[])
    .filter((p) => p.dignity);
  expect(withDignity.length).toBeGreaterThan(0);
  for (const p of withDignity) expect(typeof p.dignityModern).toBe('boolean');
});

test('English output does not leak Chinese diagnostic keys', () => {
  const c = computeChart({ ...EXACT, lang: 'en' } as never);
  expect(Object.keys(c.diagnostics.orbs).join('')).not.toMatch(/[一-龥]/);
});

// ------------------------------------------------------- input-space gaps
// Every test above (and every test in the rest of the suite) passes an exact
// city name. The partial-match path had zero coverage, and that is where a
// raw TypeError was leaking to MCP callers.

test('a partial place match across timezones is refused, never crashed on', () => {
  // "Spring" prefix-matches Springfield/Springdale/... in several zones while
  // exactly matching none of them. The dominance branch read [0] of an empty
  // array and threw "undefined is not an object" straight at the caller.
  for (const place of ['Spring', 'Santo', 'San Jo']) {
    let err: unknown;
    try {
      computeChart({
        solarDate: { year: 1990, month: 6, day: 15 },
        clockTime: { hour: 20, minute: 0 }, place,
      } as never);
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    const msg = String((err as Error).message ?? err);
    expect(msg).not.toMatch(/undefined is not an object|Cannot read/i);
    expect(msg).toMatch(/multiple candidate|specify more|no match/i);
  }
});

test('a near-24h window enumerates every house, not just the endpoint one', () => {
  // from 20:00 to 19:59 is a legal 23h59m window. The cusps sweep a full turn,
  // so the body passes through all twelve houses -- but the enumeration loop
  // stops immediately when the start and end house coincide.
  const c = computeChart({
    solarDate: { year: 1990, month: 6, day: 15 }, place: 'Los Angeles',
    clockTimeRange: { from: { hour: 20, minute: 0 }, to: { hour: 19, minute: 59 } },
  } as never);
  const sun = c.positions.find((p: { body: string }) => p.body === '太阳');
  expect(sun.houseCandidates).toHaveLength(12);
});

test('mixing `place` with an explicit latitude is refused, not silently blended', () => {
  // The resolver already refuses `place` + `longitude` without a timezone.
  // Latitude drives the Ascendant directly, so silently letting a caller
  // graft an unrelated latitude onto a resolved city is the same class of
  // mistake with a worse blast radius.
  expect(() => computeChart({
    solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 20, minute: 0 },
    place: 'Los Angeles', latitude: 60,
  } as never)).toThrow(/latitude|both|either/i);
});

test('range mode declares applying as omitted, exactly as date-only does', () => {
  const b = computeChart({
    solarDate: { year: 1990, month: 6, day: 15 }, place: 'Los Angeles',
    clockTimeRange: { from: { hour: 18, minute: 0 }, to: { hour: 23, minute: 59 } },
  } as never);
  expect(b.diagnostics.omitted.map((o: { field: string }) => o.field))
    .toContain('aspects[].applying');
});
