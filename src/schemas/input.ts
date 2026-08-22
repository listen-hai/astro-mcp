import { z } from 'zod';

export const ASTRO_YEAR_MIN = 1900;
export const ASTRO_YEAR_MAX = 2100;

export function yearRangeMessage(field: string): string {
  return `${field} must be between ${ASTRO_YEAR_MIN} and ${ASTRO_YEAR_MAX} (the range this service's ephemeris covers).`;
}

export const ASTRO_DEFAULTS = {
  houseSystem: 'placidus',
  zodiac: 'tropical',
  node: 'true',
  lilith: 'mean',
  minorAspects: false,
  declinationAspects: false,
  asteroids: false,
  chiron: true,
  lang: 'zh',
} as const;

export const SolarDateSchema = z
  .object({
    year: z
      .number()
      .int()
      .min(ASTRO_YEAR_MIN, yearRangeMessage('Solar year'))
      .max(ASTRO_YEAR_MAX, yearRangeMessage('Solar year')),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  })
  .strict();

export const ClockTimeSchema = z
  .object({
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  })
  .strict();

export const AstroInputObjectSchema = z
  .object({
    place: z
      .string()
      .max(120)
      .optional()
      .describe('Birth city name in English, e.g. "Beijing", "New York", "Tacoma, WA"'),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .optional()
      .describe('Birth location longitude (positive = East, negative = West)'),
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe(
        'Birth location latitude (positive = North). Required with explicit coordinates; derived from `place` otherwise. Western astrology needs it for the Ascendant and houses.'
      ),
    timezone: z.string().max(64).optional().describe('IANA timezone name'),
    dstFold: z
      .union([z.literal(0), z.literal(1)])
      .optional()
      .describe(
        'DST fall-back disambiguation: 0 = first occurrence (DST), 1 = second occurrence (standard time)'
      ),
    solarDate: SolarDateSchema.describe('Solar (Gregorian) birth date'),
    clockTime: ClockTimeSchema.optional().describe(
      'Exact clock time of birth. Omit for the unknown-time modes.'
    ),
    clockTimeRange: z
      .object({ from: ClockTimeSchema, to: ClockTimeSchema })
      .strict()
      .optional()
      .describe(
        'Known time window (e.g. "in the evening"). from > to means the window crosses midnight. Mutually exclusive with clockTime.'
      ),
    houseSystem: z.enum(['placidus', 'whole-sign', 'equal', 'porphyry']).default('placidus'),
    zodiac: z.enum(['tropical', 'sidereal-lahiri', 'sidereal-fagan-bradley']).default('tropical'),
    node: z.enum(['true', 'mean']).default('true'),
    lilith: z.enum(['mean', 'true']).default('mean'),
    orbs: z.record(z.string(), z.number().min(0).max(30)).optional()
    .describe('Per-aspect orb overrides in degrees, keyed by aspect: conjunction, '
      + 'sextile, square, trine, opposition, semisextile, semisquare, quintile, '
      + 'sesquiquadrate, quincunx. Orbs are the most school-dependent number in a '
      + 'chart, so the defaults (8/6/7/7/8 for the majors) are only a starting '
      + 'point. Unknown keys are rejected rather than ignored.'),
  minorAspects: z.boolean().default(false),
    declinationAspects: z.boolean().default(false),
    asteroids: z.boolean().default(false),
    chiron: z.boolean().default(true),
    lang: z.enum(['zh', 'en']).default('zh'),
  })
  .strict();

export const AstroInputSchema = AstroInputObjectSchema.refine(
  (v) => !(v.clockTime && v.clockTimeRange),
  { message: 'Pass at most one of clockTime / clockTimeRange.' }
).refine(
  (v) => v.place || (v.longitude !== undefined && v.latitude !== undefined && v.timezone),
  { message: 'Provide either `place`, or all of `longitude` + `latitude` + `timezone`.' }
).refine(
  // Latitude drives the Ascendant and every house cusp. Letting a caller graft
  // one onto a resolved city yields a chart for neither location, silently.
  // The resolver already refuses `place` + `longitude` without a timezone;
  // this closes the same hole on the other coordinate.
  (v) => !(v.place && (v.longitude !== undefined || v.latitude !== undefined)),
  {
    message: 'Pass either `place` or explicit `longitude`+`latitude`+`timezone`, not both. '
      + 'Latitude drives the Ascendant, so grafting one onto a resolved city would '
      + 'silently produce a chart for neither location.',
  }
);

export type AstroInput = z.infer<typeof AstroInputObjectSchema>;

export const LookupLocationSchema = z.object({
  query: z
    .string()
    .min(1, 'Search query cannot be empty')
    .max(120, 'query must be 120 characters or fewer.')
    .describe('City name in English, e.g. "Tokyo", "London", "San Francisco"'),
});

export type LookupLocationInput = z.input<typeof LookupLocationSchema>;

// ---------------------------------------------------------------------------
// v2: synastry, transits, retrograde search
// ---------------------------------------------------------------------------

/**
 * `calculate_synastry`'s input: two natal charts (each the full natal-input
 * shape, so `AstroInputSchema`'s own validation applies to both) plus the
 * house-system/zodiac/node/lilith/orbs/lang convention switches, which apply
 * to BOTH charts and are reported once at the top level (spec: "口径开关...
 * 只在顶层 diagnostics 报一次") -- reused directly off `AstroInputObjectSchema`'s
 * own field definitions so the two tools cannot drift apart.
 */
export const SynastryInputSchema = z
  .object({
    personA: AstroInputObjectSchema.describe("Person A's birth data (same shape as calculate_natal's input)"),
    personB: AstroInputObjectSchema.describe("Person B's birth data (same shape as calculate_natal's input)"),
    houseSystem: AstroInputObjectSchema.shape.houseSystem,
    zodiac: AstroInputObjectSchema.shape.zodiac,
    node: AstroInputObjectSchema.shape.node,
    lilith: AstroInputObjectSchema.shape.lilith,
    orbs: AstroInputObjectSchema.shape.orbs,
    minorAspects: AstroInputObjectSchema.shape.minorAspects,
    declinationAspects: AstroInputObjectSchema.shape.declinationAspects,
    asteroids: AstroInputObjectSchema.shape.asteroids,
    chiron: AstroInputObjectSchema.shape.chiron,
    lang: AstroInputObjectSchema.shape.lang,
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const key of ['personA', 'personB'] as const) {
      const result = AstroInputSchema.safeParse(v[key]);
      if (!result.success) {
        for (const issue of result.error.issues) ctx.addIssue({ ...issue, path: [key, ...issue.path] });
      }
    }
  });

export type SynastryInput = z.infer<typeof SynastryInputSchema>;

const TransitTargetSchema = z
  .object({
    solarDate: SolarDateSchema.describe('Solar (Gregorian) target date'),
    clockTime: ClockTimeSchema.describe('Clock time of the target instant'),
    dstFold: z
      .union([z.literal(0), z.literal(1)])
      .optional()
      .describe('DST fall-back disambiguation for the target instant'),
  })
  .strict();

/**
 * `calculate_transits`'s input: the exact same flat natal-input contract as
 * `calculate_natal` (so a Western chart and its transits stay aligned for
 * the same birth data) plus an optional `target` -- the instant to compute
 * the transiting sky for. Omitting it defaults to "now". Reuses
 * `AstroInputObjectSchema`'s own three mutual-exclusion/location refinements
 * (rather than `AstroInputSchema`, whose refinements are already baked into a
 * `ZodEffects` with no `.extend()`) so this schema gets identical validation
 * to `calculate_natal` without duplicating the natal object shape.
 */
export const TransitsInputSchema = AstroInputObjectSchema.extend({
  target: TransitTargetSchema.optional().describe(
    'The instant to compute the transiting sky for. Omit entirely to default to the current instant ("now").'
  ),
})
  .strict()
  .refine((v) => !(v.clockTime && v.clockTimeRange), {
    message: 'Pass at most one of clockTime / clockTimeRange.',
  })
  .refine((v) => v.place || (v.longitude !== undefined && v.latitude !== undefined && v.timezone), {
    message: 'Provide either `place`, or all of `longitude` + `latitude` + `timezone`.',
  })
  .refine((v) => !(v.place && (v.longitude !== undefined || v.latitude !== undefined)), {
    message: 'Pass either `place` or explicit `longitude`+`latitude`+`timezone`, not both. '
      + 'Latitude drives the Ascendant, so grafting one onto a resolved city would '
      + 'silently produce a chart for neither location.',
  });

export type TransitsInput = z.infer<typeof TransitsInputSchema>;

const RETROGRADE_BODY_VALUES = [
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
] as const;

/**
 * `find_retrograde`'s input: no birth data at all -- just a body and a
 * calendar window (spec soul: this is the one v2 tool with nothing to
 * degrade). Sun/Moon are accepted here and rejected with a specific message
 * by `findRetrograde` itself (see src/core/retrograde.ts) rather than by the
 * schema, so a caller gets "Sun/Moon never retrograde" instead of a generic
 * enum-mismatch error.
 */
export const RetrogradeInputSchema = z
  .object({
    body: z.enum(RETROGRADE_BODY_VALUES).describe('Which body to search for retrograde periods'),
    from: SolarDateSchema.describe('Start of the search window (inclusive)'),
    to: SolarDateSchema.describe('End of the search window (inclusive)'),
    lang: z.enum(['zh', 'en']).default('zh'),
  })
  .strict();

export type RetrogradeInput = z.infer<typeof RetrogradeInputSchema>;
