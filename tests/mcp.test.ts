import { expect, test } from 'bun:test';
import { listTools, callTool } from '../src/mcp/server';
import { AstroInputObjectSchema } from '../src/schemas/input';

test('exactly five tools are registered', async () => {
  // Was "exactly two" (calculate_natal, lookup_location) until the v2 task
  // brief (docs/spec.md section 1 lists synastry/transits/returns as v2
  // non-goals) added calculate_synastry/calculate_transits/find_retrograde -- see
  // tests/synastry.test.ts, tests/transits.test.ts, tests/retrograde.test.ts.
  // This assertion was left stale by the commit that added those three test
  // files (971f5ca) without updating the tool-count guard here; flagged in
  // the v2 implementation report per this project's own "stop and say so"
  // convention rather than silently reinterpreted.
  expect((await listTools()).map((t) => t.name).sort())
    .toEqual(['calculate_natal', 'calculate_synastry', 'calculate_transits', 'find_retrograde', 'lookup_location']);
});

test('the advertised JSON Schema must not drift from the zod schema', async () => {
  const natal = (await listTools()).find((t) => t.name === 'calculate_natal')!;
  const zodKeys = Object.keys(AstroInputObjectSchema.shape).sort();
  const advertised = Object.keys(
    (natal.inputSchema as { properties: Record<string, unknown> }).properties).sort();
  expect(advertised).toEqual(zodKeys);
});

test('the tool description declares this is MODERN astrology (spec 0)', async () => {
  const natal = (await listTools()).find((t) => t.name === 'calculate_natal')!;
  expect(natal.description).toMatch(/modern/i);
  expect(natal.description).toMatch(/traditional|classical|Hellenistic/i);
});

test('the tool description explains the unknown-birth-time behaviour', async () => {
  const natal = (await listTools()).find((t) => t.name === 'calculate_natal')!;
  expect(natal.description).toMatch(/clockTimeRange/);
  expect(natal.description).toMatch(/unknown|omitted|absent/i);
});

test('the tool description points Chinese systems at the sibling servers', async () => {
  const natal = (await listTools()).find((t) => t.name === 'calculate_natal')!;
  expect(natal.description).toMatch(/ziwei-mcp/);
  expect(natal.description).toMatch(/bazi-mcp/);
});

test('calculate_natal returns a chart end to end', async () => {
  const r = await callTool('calculate_natal', {
    solarDate: { year: 1990, month: 6, day: 15 },
    clockTime: { hour: 20, minute: 0 },
    place: 'Los Angeles, CA',
  });
  const chart = JSON.parse(r.content[0].text);
  expect(chart.highlights.sunSign).toBe('双子');
  expect(chart.highlights.ascendantSign).toBe('射手');
});

test('lookup_location returns coordinates including latitude', async () => {
  const r = await callTool('lookup_location', { query: 'Los Angeles, CA' });
  const hits = JSON.parse(r.content[0].text);
  expect(hits[0].latitude).toBeDefined();
  expect(hits[0].timezone).toBe('America/Los_Angeles');
});

test('output is Chinese by default and English on request', async () => {
  const base = {
    solarDate: { year: 1990, month: 6, day: 15 },
    clockTime: { hour: 20, minute: 0 }, place: 'Los Angeles, CA',
  };
  const zh = (await callTool('calculate_natal', base)).content[0].text;
  expect(zh).toContain('双子');
  expect(zh).not.toContain('Gemini');
  const en = (await callTool('calculate_natal', { ...base, lang: 'en' })).content[0].text;
  expect(en).toContain('Gemini');
});

test('a schema violation is reported, not silently coerced', async () => {
  await expect(callTool('calculate_natal', {
    solarDate: { year: 1899, month: 6, day: 15 }, place: 'Los Angeles, CA',
  })).rejects.toThrow();
});
