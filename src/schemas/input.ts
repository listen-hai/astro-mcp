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

const SolarDateSchema = z
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

const ClockTimeSchema = z
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
