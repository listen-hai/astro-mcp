import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { AstroInputSchema, AstroInputObjectSchema, LookupLocationSchema } from '../schemas/input';
import { computeChart } from '../core/chart';
import { lookupCity } from '../geo/resolver';
import rootPkg from '../../package.json';

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
    description: 'Birth city name in ENGLISH (e.g. "Beijing", "New York", "Tacoma, WA"). Translate from other languages before passing.',
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
  minorAspects: {
    type: 'boolean',
    description: 'Include minor aspects (semisextile 30, semisquare 45, quintile 72, quincunx 150) alongside the five major aspects. Off by default.',
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
  lang: {
    type: 'string',
    enum: ['zh', 'en'],
    description: 'Output language for all astrology terms (signs, bodies, aspects, dignities, diagnostic prose). Chinese ("zh") by default, matching ziwei-mcp/bazi-mcp.',
  },
};

const natalProperties: Record<string, object> = Object.fromEntries(
  Object.entries(natalPropertiesRaw).map(([field, prop]) => [field, withZodConstraints(inputZodShape[field], prop)])
);

const TOOLS: Tool[] = [
  {
    name: 'calculate_natal',
    description:
      'Computes a MODERN Western astrology natal (birth) chart: Ascendant/Midheaven/houses, the ten planets plus Chiron, lunar nodes, Black Moon Lilith, the Part of Fortune, essential dignities, and aspects -- verified against JPL Horizons (see `diagnostics.accuracyNote`). This is modern astrology (Uranus/Neptune/Pluto, Chiron, Lilith, Placidus houses, aspect-type orbs); traditional/classical/Hellenistic technique (triplicities, terms/faces, classical moiety orbs, antiscia) is deliberately out of scope -- this tool will not silently approximate it. ' +
      'Pass at most one of `clockTime` (exact birth time) or `clockTimeRange` (a known window, e.g. "evening"); omit both if the birth time is genuinely unknown. This is the core design commitment of this tool: it NEVER fabricates a birth time -- there is no default-to-noon fallback. With `clockTime`, the full chart is returned. With `clockTimeRange`, the Ascendant/Midheaven/houses/Part of Fortune reduce to candidate sign segments (`diagnostics.method` is "bisect" below the polar circle where the Ascendant is provably monotonic, or "scan" above it -- see `diagnostics.ascendantMonotonic`); `aspects[].applying` is omitted (it needs an exact relative speed). With neither given, `angles`/`houses`/`positions[].house`/`partOfFortune` are OMITTED FIELDS entirely (not null) -- check `diagnostics.omitted` for why each one is absent -- and the Sun/Moon/other bodies report a `sign` (or `signCandidates` on a day the Sun crosses a sign boundary, ~12 days/year) with a `degreeRange` instead of a single degree. ' +
      'Shares its time-conversion and geographic-resolution layers with the sibling servers ziwei-mcp (紫微斗数) and bazi-mcp (八字/四柱): the same `place`/`longitude`/`timezone`/`dstFold`/`solarDate`/`clockTime` fields resolve to the same UTC instant and location, so a Western, Zi Wei, and Bazi chart requested for the same birth data stay aligned. Call those servers instead for Chinese-system charts -- this tool covers Western astrology only.',
    inputSchema: {
      type: 'object',
      properties: { ...natalProperties },
      required: ['solarDate'],
      additionalProperties: false,
    },
  },
  {
    name: 'lookup_location',
    description:
      'Looks up a city\'s geographic coordinates (longitude, latitude) and IANA timezone. IMPORTANT: use ENGLISH city names; translate first if given another language (e.g. 东京 -> "Tokyo", 巴黎 -> "Paris"). Covers 7,329 cities across 227 countries -- the same database used by ziwei-mcp/bazi-mcp\'s own lookup_location.',
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

export async function callTool(
  name: string,
  args: unknown
): Promise<{ content: { type: 'text'; text: string }[] }> {
  if (name === 'calculate_natal') {
    const input = AstroInputSchema.parse(args);
    const chart = computeChart(input);
    return { content: [{ type: 'text', text: JSON.stringify(chart, null, 2) }] };
  }
  if (name === 'lookup_location') {
    const { query } = LookupLocationSchema.parse(args);
    const results = lookupCity(query);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
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
      const message = err instanceof z.ZodError ? err.issues.map(i => i.message).join('; ') : err instanceof Error ? err.message : String(err);
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
