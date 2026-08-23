import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  AstroInputSchema,
  AstroInputObjectSchema,
  LookupLocationSchema,
  SynastryInputSchema,
  TransitsInputSchema,
  RetrogradeInputSchema,
  SYNASTRY_CONVENTION_KEYS,
} from '../schemas/input';
import { computeChart } from '../core/chart';
import { computeSynastry } from '../core/synastry';
import { computeTransits } from '../core/transits';
import { findRetrograde } from '../core/retrograde';
import { lookupCity, lookupCityWithCount, LocationError } from '../geo/resolver';
import rootPkg from '../../package.json';

// case a single issue's own message is huge (e.g. a long echoed value).
const MAX_REPORTED_ISSUES = 8;
const MAX_ERROR_MESSAGE_LENGTH = 4000;

// Zod issue paths are dropped here in the old code, so the LLM caller sees a bare
// "Required" or "Expected number, received string" with no field name — even
// though the path (e.g. ["solarDate", "day"]) is right there on the issue. Prefix
// it when present. The hand-written `.strict().refine(...)` messages in
// schemas/input.ts (e.g. "Must provide either solarDate or lunarDate.") attach to
// the whole object and carry an empty path — leave those bare rather than
// prefixing a stray ": " separator onto an already-readable sentence.
export function formatZodError(err: z.ZodError): string {
  const formatted = err.issues.map(i =>
    i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message
  );
  const shown = formatted.slice(0, MAX_REPORTED_ISSUES);
  const omitted = formatted.length - shown.length;
  let msg = shown.join('; ');
  if (omitted > 0) msg += `; …and ${omitted} more validation errors`;
  if (msg.length > MAX_ERROR_MESSAGE_LENGTH) {
    msg = `${msg.slice(0, MAX_ERROR_MESSAGE_LENGTH)}… (truncated)`;
  }
  return msg;
}

/**
 * Derives JSON-Schema `default`/`minimum`/`maximum` from the zod schema
 * instead of hand-copying them, so the advertised tool schema cannot drift
 * from the zod schema that actually validates the call (tests/mcp.test.ts:
 * "the advertised JSON Schema must not drift from the zod schema"). Mirrors
 * ziwei-mcp's src/mcp/server.ts withZodConstraints -- same fix, same reason.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapZod(schema: any): any {
  let current = schema;
  while (current?._def?.innerType || current?._def?.schema) {
    current = current._def.innerType ?? current._def.schema;
  }
  return current;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodNumberBounds(schema: any): { minimum?: number; maximum?: number } {
  const base = unwrapZod(schema);
  if (base?._def?.typeName !== 'ZodNumber') return {};
  const bounds: { minimum?: number; maximum?: number } = {};
  for (const check of base._def.checks ?? []) {
    if (check.kind === 'min') bounds.minimum = check.value;
    if (check.kind === 'max') bounds.maximum = check.value;
  }
  return bounds;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodDefaultValue(schema: any): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = schema;
  while (node?._def?.innerType && node._def.typeName !== 'ZodDefault') node = node._def.innerType;
  return node?._def?.typeName === 'ZodDefault' ? node._def.defaultValue() : undefined;
}

/**
 * Merges a zod field's derived default/minimum/maximum onto a hand-written
 * JSON Schema property, recursing into nested object properties (solarDate.year,
 * clockTimeRange.from.hour, ...) using the zod field's own `.shape`. `type`/
 * `enum`/`description` are left exactly as hand-written.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withZodConstraints(zodField: any, prop: any): any {
  if (!zodField) return prop;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merged: any = { ...prop, ...zodNumberBounds(zodField) };
  const def = zodDefaultValue(zodField);
  if (def !== undefined) merged.default = def;

  const base = unwrapZod(zodField);
  if (merged.properties && base?._def?.typeName === 'ZodObject') {
    const nestedShape = base.shape as Record<string, unknown>;
    merged.properties = Object.fromEntries(
      Object.entries(merged.properties).map(([nested, nestedProp]) => [
        nested,
        withZodConstraints(nestedShape[nested], nestedProp),
      ])
    );
  }
  return merged;
}

const inputZodShape = AstroInputObjectSchema.shape as Record<string, unknown>;

const CLOCK_TIME_PROPERTY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hour: { type: 'integer', description: 'Hour (0-23)' },
    minute: { type: 'integer', description: 'Minute (0-59)' },
  },
  required: ['hour', 'minute'],
};

const natalPropertiesRaw: Record<string, object> = {
  place: {
    type: 'string',
    description: 'Birth city name in ENGLISH (e.g. "Beijing", "New York", "Tacoma, WA"). Translate from other languages before passing. Same-name cities are REFUSED, never guessed: the result carries `code: "ambiguous_place"` and a `candidates` list. Settle it BEFORE charting -- call lookup_location first, or pass "City, Province/Country" (e.g. "Los Angeles, CA").',
  },
  longitude: {
    type: 'number',
    description: 'Birth location longitude (positive = East, negative = West, e.g. 116.4074 or -122.4443)',
  },
  latitude: {
    type: 'number',
    description: 'Birth location latitude (positive = North). Required alongside explicit longitude/timezone; derived automatically from `place` otherwise. Western astrology needs it for the Ascendant and houses -- ziwei-mcp/bazi-mcp do not have this field.',
  },
  timezone: {
    type: 'string',
    description: 'Birth location IANA timezone (e.g. "Asia/Shanghai", "America/Los_Angeles")',
  },
  dstFold: {
    type: 'integer',
    enum: [0, 1],
    description: 'DST fall-back disambiguation: 0 = first occurrence (DST), 1 = second occurrence (standard time)',
  },
  solarDate: {
    type: 'object',
    description: 'Solar (Gregorian) birth date',
    additionalProperties: false,
    properties: {
      year: { type: 'integer', description: 'Solar year (1900-2100, e.g. 1990)' },
      month: { type: 'integer', description: 'Month (1-12)' },
      day: { type: 'integer', description: 'Day (1-31)' },
    },
    required: ['year', 'month', 'day'],
  },
  clockTime: {
    ...CLOCK_TIME_PROPERTY,
    description: 'Exact clock time of birth (mode A: full chart, no degradation). Mutually exclusive with clockTimeRange -- omit both for the date-only mode.',
  },
  clockTimeRange: {
    type: 'object',
    additionalProperties: false,
    description: 'Known time window when the exact minute is unknown (e.g. "in the evening", mode B). `from > to` means the window crosses midnight (e.g. 20:00-02:00). Mutually exclusive with clockTime. The Ascendant/Midheaven/houses/Part of Fortune degrade to candidate sign segments instead of single values -- see the tool description.',
    properties: {
      from: { ...CLOCK_TIME_PROPERTY, description: 'Start of the window' },
      to: { ...CLOCK_TIME_PROPERTY, description: 'End of the window' },
    },
    required: ['from', 'to'],
  },
  houseSystem: {
    type: 'string',
    enum: ['placidus', 'whole-sign', 'equal', 'porphyry'],
    description: 'House system. Placidus is the default -- the mainstream convention among Chinese-language astrology tools (占星之门/测测/爱星盘), not auseklis\'s own whole-sign default. Undefined above the polar circle; falls back to Porphyry with `houses.note` set (never silently).',
  },
  zodiac: {
    type: 'string',
    enum: ['tropical', 'sidereal-lahiri', 'sidereal-fagan-bradley'],
    description: 'Zodiac frame. Tropical (Western mainstream) by default; the two sidereal ayanamsas are exposed for Vedic-adjacent use cases.',
  },
  node: {
    type: 'string',
    enum: ['true', 'mean'],
    description: 'Lunar node calculation: "true" (osculating node, default) or "mean". True/mean can differ by up to ~1.6 deg -- enough to cross a sign boundary.',
  },
  lilith: {
    type: 'string',
    enum: ['mean', 'true'],
    description: 'Black Moon Lilith: "mean" (mean lunar apogee, default -- the popular-astrology convention) or "true" (osculating apogee).',
  },
  partOfFortune: {
    type: 'string',
    enum: ['reverse_at_night', 'never_reverse'],
    description: 'Whether the Part of Fortune formula reverses on a night chart. "reverse_at_night" (default) is the sect-based reading: Asc + Moon - Sun by day, Asc + Sun - Moon by night. "never_reverse" applies the day formula to every chart, as part of modern practice does. The two agree on every day chart and can differ by tens of degrees on a night one -- enough to change both sign and house. `partOfFortune.dayChart` says which kind of chart this is; `diagnostics.partOfFortune` echoes the rule that produced the longitude. Pass this only when the user follows a specific convention.',
  },
  orbs: {
    type: 'object',
    description: 'Per-aspect orb overrides in degrees. Keys: conjunction, sextile, square, trine, opposition, semisextile, semisquare, quintile, sesquiquadrate, quincunx. Orbs are the most school-dependent number in a chart -- the defaults (conjunction/opposition 8, square/trine 7, sextile 6, minors 2-3) are the common modern convention, not a fact. An unknown key is rejected rather than ignored, so a typo cannot leave the default silently in place. The table actually applied comes back in diagnostics.orbs.',
    additionalProperties: { type: 'number', minimum: 0, maximum: 30 },
  },
  minorAspects: {
    type: 'boolean',
    description: 'Include minor aspects (semisextile 30, semisquare 45, quintile 72, sesquiquadrate 135, quincunx 150) alongside the five major aspects. Off by default.',
  },
  declinationAspects: {
    type: 'boolean',
    description: 'Include declination aspects (parallel/contraparallel), computed from real ecliptic-latitude-derived declination. Off by default -- a minority convention, and the exact defect (hard-coded zero declination) that made auseklis fabricate these.',
  },
  asteroids: {
    type: 'boolean',
    description: 'Include the four major asteroids (Ceres, Pallas, Juno, Vesta) alongside Chiron. Off by default -- low mainstream usage; Chiron alone is controlled by `chiron`.',
  },
  chiron: {
    type: 'boolean',
    description: 'Include Chiron. On by default -- standard in modern psychological astrology and has real Chinese social-media traction.',
  },
  southNodeAspects: {
    type: 'boolean',
    description: 'Include aspects to the South Node. Off by default -- the South Node sits exactly 180deg from the North Node, so any aspect to it automatically mirrors one to the North Node at the same orb (astro.com/astro-seek/TimePassages/爱星盘 all hide it by default). The South Node\'s own sign/house/overlay position is unaffected -- only its aspects.',
  },
  lang: {
    type: 'string',
    enum: ['zh', 'en'],
    description: 'Output language for all astrology terms (signs, bodies, aspects, dignities, diagnostic prose). Chinese ("zh") by default, matching ziwei-mcp/bazi-mcp.',
  },
};

const natalProperties: Record<string, object> = Object.fromEntries(
  Object.entries(natalPropertiesRaw).map(([field, prop]) => [field, withZodConstraints(inputZodShape[field], prop)])
);

// ---------------------------------------------------------------------------
// v2: synastry, transits, retrograde -- properties reused from natalProperties
// wherever the field is literally the same zod definition, so the advertised
// schema for these three tools cannot drift from calculate_natal's own
// fields any more than calculate_natal's own schema can drift from its zod.
// ---------------------------------------------------------------------------

// Person schemas reject the convention keys outright (see SynastryPersonSchema
// in schemas/input.ts) -- the advertised per-person properties must match, or
// a caller would see a field advertised that the schema then rejects.
const personProperty = (label: 'A' | 'B'): object => ({
  type: 'object',
  description: `Person ${label}'s birth data -- identical shape to calculate_natal's own input, minus the convention switches (houseSystem/zodiac/node/lilith/orbs/minorAspects/declinationAspects/asteroids/chiron/southNodeAspects/lang): those apply to both charts and are only accepted at the top level, see below.`,
  additionalProperties: false,
  properties: Object.fromEntries(
    Object.entries(natalProperties).filter(([key]) => !(SYNASTRY_CONVENTION_KEYS as readonly string[]).includes(key))
  ),
  required: ['solarDate'],
});

const synastryProperties: Record<string, object> = {
  personA: personProperty('A'),
  personB: personProperty('B'),
  ...Object.fromEntries(SYNASTRY_CONVENTION_KEYS.map((k) => [k, natalProperties[k]])),
};

const transitTargetProperty: object = {
  type: 'object',
  additionalProperties: false,
  description: 'The instant to compute the transiting sky for. Omit entirely to default to the current instant ("now") -- see diagnostics.targetSource/targetUtc. If provided, both solarDate and clockTime are required together.',
  properties: {
    solarDate: { ...(natalProperties.solarDate as object), description: 'Solar (Gregorian) target date' },
    clockTime: { ...(natalProperties.clockTime as object), description: 'Clock time of the target instant' },
    dstFold: { ...(natalProperties.dstFold as object), description: 'DST fall-back disambiguation for the target instant: 0 = first occurrence (DST), 1 = second occurrence (standard time)' },
  },
  required: ['solarDate', 'clockTime'],
};

const transitsProperties: Record<string, object> = {
  ...natalProperties,
  target: transitTargetProperty,
};

const retrogradeProperties: Record<string, object> = {
  body: {
    type: 'string',
    enum: ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'],
    description: 'Which body to search for retrograde periods. Sun/Moon are valid values here but are refused by the tool itself with an explicit "never retrograde" error, not a generic schema mismatch.',
  },
  from: { ...(natalProperties.solarDate as object), description: 'Start of the search window (inclusive)' },
  to: { ...(natalProperties.solarDate as object), description: 'End of the search window (inclusive), at most 5 years after `from`' },
  lang: natalProperties.lang,
};

const TOOLS: Tool[] = [
  {
    name: 'calculate_natal',
    description:
      'Computes a MODERN Western astrology natal (birth) chart: Ascendant/Midheaven/houses, the ten planets plus Chiron, lunar nodes, Black Moon Lilith, the Part of Fortune, essential dignities, and aspects -- verified against JPL Horizons (see `diagnostics.accuracyNote`). This is modern astrology (Uranus/Neptune/Pluto, Chiron, Lilith, Placidus houses, aspect-type orbs); traditional/classical/Hellenistic technique (triplicities, terms/faces, classical moiety orbs, antiscia) is deliberately out of scope -- this tool will not silently approximate it.  PRESENTING UNCERTAINTY: when a field comes back as a candidate list (`signCandidates`, `houseCandidates`, `ascendantSignCandidates`, `orbRange`, `degreeRange`), report ALL of them to the user -- do not pick one, and do not narrate a range as a single value. When a field is absent, say it could not be determined and why; the reason is in `diagnostics.omitted`. Collapsing these back into a confident single answer undoes the whole point of the degradation.' +
      'Pass at most one of `clockTime` (exact birth time) or `clockTimeRange` (a known window, e.g. "evening"); omit both if the birth time is genuinely unknown. This is the core design commitment of this tool: it NEVER fabricates a birth time -- there is no default-to-noon fallback. With `clockTime`, the full chart is returned. With `clockTimeRange`, the Ascendant/Midheaven/houses reduce to candidate sign segments (`partOfFortune` is omitted entirely -- it needs both the Ascendant and the day/night determination, and a window settles neither) (`diagnostics.method` is "bisect" below the polar circle where the Ascendant is provably monotonic, or "scan" above it -- see `diagnostics.ascendantMonotonic`); `aspects[].applying` is omitted (it needs an exact relative speed). With neither given, `angles`/`houses`/`positions[].house`/`partOfFortune` are OMITTED FIELDS entirely (not null) -- check `diagnostics.omitted` for why each one is absent -- and the Sun/Moon/other bodies report a `sign` (or `signCandidates` on a day the Sun crosses a sign boundary, ~12 days/year) with a `degreeRange` instead of a single degree. ' +
      'Shares its time-conversion and geographic-resolution layers with the sibling servers ziwei-mcp (紫微斗数) and bazi-mcp (八字/四柱): the same `place`/`longitude`/`timezone`/`dstFold`/`solarDate`/`clockTime` fields resolve to the same UTC instant and location, so a Western, Zi Wei, and Bazi chart requested for the same birth data stay aligned. Call those servers instead for Chinese-system charts -- this tool covers Western astrology only.',
    inputSchema: {
      type: 'object',
      properties: { ...natalProperties },
      required: ['solarDate'],
      additionalProperties: false,
    },
  },
  {
    name: 'calculate_synastry',
    description:
      'Synastry (合盘): aspects and house overlays BETWEEN two natal charts, `personA` and `personB` -- this is a comparison, not a single natal chart (call calculate_natal for that). Both people accept the same birth-input contract as calculate_natal (place/longitude/latitude/timezone/dstFold/solarDate/clockTime(-Range)), including its unknown-birth-time behavior (NEVER fabricates a birth time) -- EXCEPT the convention switches (houseSystem/zodiac/node/lilith/orbs/minorAspects/declinationAspects/asteroids/chiron/southNodeAspects/lang), which `personA`/`personB` do NOT accept at all (rejected outright, not silently ignored): those apply to BOTH charts uniformly and are set and reported once, in the top-level `diagnostics`, never per person.  PRESENTING UNCERTAINTY: when a field comes back as a candidate list (`signCandidates`, `houseCandidates`, `ascendantSignCandidates`, `orbRange`, `degreeRange`), report ALL of them to the user -- do not pick one, and do not narrate a range as a single value. When a field is absent, say it could not be determined and why; the reason is in `diagnostics.omitted`. Collapsing these back into a confident single answer undoes the whole point of the degradation.'
      + 'A time WINDOW (`clockTimeRange`) on either side degrades that side\'s houses to a candidate list rather than deleting them: `overlays.*.houseCandidates` and `transiting[].natalHouseCandidates`-style degradation (see calculate_natal\'s own `clockTimeRange` behavior) -- only a whole-day-unknown side loses its houses entirely. '
      + 'House overlays are DIRECTIONAL: `overlays.aInB` places A\'s bodies into B\'s houses, which needs B to have at least a known birth time (exact or a window); `overlays.bInA` is the reverse. If either side\'s time is entirely unknown (date-only), only the overlay that needed THAT side\'s houses is omitted (see `diagnostics.omitted`) -- the other direction still returns normally. Ascendant/Midheaven aspects only exist for whichever side has an exact time. Any aspect touching a Moon on an unknown-time side is flagged `uncertain: true` (the Moon moves 12-15 deg/day). `applying` is never included in the aspect list -- two natal charts are each frozen at their own birth instant, so "approaching exactness" across two different epochs is not a meaningful thing to report.',
    inputSchema: {
      type: 'object',
      properties: { ...synastryProperties },
      required: ['personA', 'personB'],
      additionalProperties: false,
    },
  },
  {
    name: 'calculate_transits',
    description:
      'Transits (行运): where the sky stands RIGHT NOW (or at any given instant) against a natal chart. Takes the exact same flat birth-input fields as calculate_natal (place/longitude/latitude/timezone/dstFold/solarDate/clockTime(-Range)) plus an optional `target`: the instant to compute the transiting sky for (`target.solarDate` and `target.clockTime` are both required together if `target` is given at all). Omitting `target` entirely defaults to the current instant ("now") -- see `diagnostics.targetSource`/`diagnostics.targetUtc`. A `target` before the birth instant is rejected: a transit only makes sense against a chart that already exists.  PRESENTING UNCERTAINTY: when a field comes back as a candidate list (`signCandidates`, `houseCandidates`, `ascendantSignCandidates`, `orbRange`, `degreeRange`), report ALL of them to the user -- do not pick one, and do not narrate a range as a single value. When a field is absent, say it could not be determined and why; the reason is in `diagnostics.omitted`. Collapsing these back into a confident single answer undoes the whole point of the degradation.'
      + 'The transiting sky is always exact (the target instant is always known) -- ALL degradation is on the NATAL side. A natal time WINDOW (`clockTimeRange`) degrades `transiting[].natalHouse` to `transiting[].natalHouseCandidates` (a candidate list, spec mode B) rather than deleting it. Only an entirely unknown (date-only) natal birth time OMITS `transiting[].natalHouse` from every entry (not null; see `diagnostics.omitted`) and drops aspects to the natal Ascendant/Midheaven -- planet-to-planet aspects to the natal chart still work either way, and any surviving aspect touching the natal Moon is flagged `uncertain: true` when the natal time is not exact (the Moon moves 12-15 deg/day).',
    inputSchema: {
      type: 'object',
      properties: { ...transitsProperties },
      required: ['solarDate'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_retrograde',
    description:
      'Finds retrograde periods for one body within a calendar window (up to 5 years) -- no birth data needed at all, this is a pure ephemeris lookup (e.g. "水星逆行", Mercury retrograde, by far the most widely recognised astrology concept in Chinese online culture). Each period reports its exact station-retrograde/station-direct instants (`startsUtc`/`endsUtc`, ISO 8601 UTC) and the zodiac sign the retrograde begins in (`startSign`). '
      + 'The Sun and Moon are refused outright with an explicit "never retrograde" error (apparent retrograde motion is an artifact of viewing another planet from a moving Earth; the Sun and Moon have no such effect) rather than silently returning an empty period list, which would read as "not retrograde this window" instead of "this concept does not apply". A window longer than 5 years is refused rather than grinding through a slow day-by-day scan -- split it into smaller windows instead.',
    inputSchema: {
      type: 'object',
      properties: { ...retrogradeProperties },
      required: ['body', 'from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'lookup_location',
    description:
      'Looks up a city\'s geographic coordinates (longitude, latitude) and IANA timezone. Use this BEFORE a chart tool whenever the place name might be ambiguous -- it is cheaper than a refused chart call. IMPORTANT: use ENGLISH city names; translate first if given another language (e.g. 东京 -> "Tokyo", 巴黎 -> "Paris"). When more than one city comes back, ASK the user which one they mean -- do not pick the first, the largest, or the most likely one. The response reports `matched` (true hit count) and `shown` (after the cap), so a capped list never reads as exhaustive. Covers 7,329 cities across 227 countries -- the same database used by ziwei-mcp/bazi-mcp\'s own lookup_location.',
    inputSchema: {
      type: 'object',
      properties: {
        query: withZodConstraints(LookupLocationSchema.shape.query, {
          type: 'string',
          description: 'City name in English, e.g. "Tokyo", "London", "San Francisco"',
        }),
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

export async function listTools(): Promise<Tool[]> {
  return TOOLS;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: true };

/**
 * An ambiguous or unknown birth place is not an exception -- it is a normal
 * outcome the agent is expected to handle by asking the user. So it comes back
 * as a structured `isError` result rather than a thrown Error, which is what a
 * schema violation (a contract breach by the caller) still is.
 */
export async function callTool(name: string, args: unknown): Promise<ToolResult> {
  try {
    return await dispatchTool(name, args);
  } catch (err) {
    if (err instanceof LocationError) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(err.toPayload(), null, 2) }] };
    }
    throw err;
  }
}

async function dispatchTool(
  name: string,
  args: unknown
): Promise<ToolResult> {
  if (name === 'calculate_natal') {
    const input = AstroInputSchema.parse(args);
    const chart = computeChart(input);
    return { content: [{ type: 'text', text: JSON.stringify(chart, null, 2) }] };
  }
  if (name === 'calculate_synastry') {
    const input = SynastryInputSchema.parse(args);
    const result = computeSynastry(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  if (name === 'calculate_transits') {
    const input = TransitsInputSchema.parse(args);
    const result = computeTransits(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  if (name === 'find_retrograde') {
    const input = RetrogradeInputSchema.parse(args);
    const result = findRetrograde(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  if (name === 'lookup_location') {
    const { query } = LookupLocationSchema.parse(args);
    // `matched` is the TRUE number of cities the query hit, not the number
    // that survived the cap. A capped list that reports its own length as the
    // count tells the caller the search was exhaustive when it was not --
    // "Santa" matches 37 cities and returns 10.
    const { matched, results } = lookupCityWithCount(query);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          query,
          matched,
          shown: results.length,
          ...(matched > results.length
            ? { note: `Showing the ${results.length} most populous of ${matched} matches. Narrow the query if none is right -- do not assume the intended city is in this list.` }
            : {}),
          results,
        }, null, 2),
      }],
    };
  }
  throw new Error(`Unknown MCP tool: ${name}`);
}

export function createAstroMcpServer(): Server {
  const server = new Server(
    { name: 'astro-mcp', version: rootPkg.version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await callTool(name, args);
    } catch (err: unknown) {
      // A location refusal ships its candidate list as JSON rather than prose.
      // The agent should not have to parse English to find out which cities
      // matched; `code` is stable enough to branch on, and `matched` keeps a
      // capped list from reading as an exhaustive one.
      if (err instanceof LocationError) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(err.toPayload(), null, 2) }] };
      }
      const message = err instanceof z.ZodError
        ? formatZodError(err)
        : err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: 'text', text: `[Astro Calculation Error] ${message}` }] };
    }
  });

  return server;
}

export async function runServer(): Promise<void> {
  const server = createAstroMcpServer();
  await server.connect(new StdioServerTransport());
  console.error('Astro MCP Server running on stdio transport.');
}
