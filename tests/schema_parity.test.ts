import { expect, test } from 'bun:test';
import { AstroInputObjectSchema, AstroInputSchema } from '../src/schemas/input';

// Snapshot, NOT a cross-repo import: CI never checks out ../ziwei, so
// `import from '../../ziwei/src/schemas/input'` would simply fail there.
// Copied from ziwei/src/schemas/input.ts and bazi/src/schemas/input.ts,
// verified 2026-08-21. If ziwei renames a field this list must be updated by
// hand -- that manual gate is deliberate, not an oversight.
const ZIWEI_SHARED_FIELDS = [
  'place', 'longitude', 'timezone', 'dstFold', 'solarDate', 'clockTime',
] as const;

test('shared fields carry the same names as ziwei/bazi', () => {
  const ours = Object.keys(AstroInputObjectSchema.shape);
  for (const f of ZIWEI_SHARED_FIELDS) expect(ours).toContain(f);
});

test('latitude is present (charts need it, ziwei does not have it)', () => {
  expect(Object.keys(AstroInputObjectSchema.shape)).toContain('latitude');
});

test('no nested location object -- the contract is flat', () => {
  expect(Object.keys(AstroInputObjectSchema.shape)).not.toContain('location');
  const r = AstroInputSchema.safeParse({
    solarDate: { year: 1990, month: 6, day: 15 },
    clockTime: { hour: 20, minute: 0 },
    location: 'Los Angeles',
  } as never);
  expect(r.success).toBe(false);
});

test('clockTime and clockTimeRange are mutually exclusive', () => {
  const r = AstroInputSchema.safeParse({
    solarDate: { year: 1990, month: 6, day: 15 },
    clockTime: { hour: 20, minute: 0 },
    clockTimeRange: { from: { hour: 18, minute: 0 }, to: { hour: 23, minute: 0 } },
    place: 'Los Angeles',
  });
  expect(r.success).toBe(false);
});

test('explicit coordinates require latitude, not just longitude', () => {
  const withoutLat = AstroInputSchema.safeParse({
    solarDate: { year: 1990, month: 6, day: 15 },
    clockTime: { hour: 20, minute: 0 },
    longitude: -118.24, timezone: 'America/Los_Angeles',
  });
  expect(withoutLat.success).toBe(false);

  const withLat = AstroInputSchema.safeParse({
    solarDate: { year: 1990, month: 6, day: 15 },
    clockTime: { hour: 20, minute: 0 },
    longitude: -118.24, latitude: 34.05, timezone: 'America/Los_Angeles',
  });
  expect(withLat.success).toBe(true);
});

test('defaults match the spec conventions table', () => {
  const r = AstroInputSchema.parse({
    solarDate: { year: 1990, month: 6, day: 15 },
    clockTime: { hour: 20, minute: 0 },
    place: 'Los Angeles',
  });
  expect(r.houseSystem).toBe('placidus');   // NOT whole-sign (auseklis A7)
  expect(r.zodiac).toBe('tropical');
  expect(r.node).toBe('true');              // NOT mean (auseklis A6)
  expect(r.lilith).toBe('mean');
  expect(r.minorAspects).toBe(false);
  expect(r.declinationAspects).toBe(false); // default off (auseklis A5)
  expect(r.chiron).toBe(true);
  expect(r.asteroids).toBe(false);
  expect(r.lang).toBe('zh');                // Chinese-first (auseklis A9)
});
