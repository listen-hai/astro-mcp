import { expect, test } from 'bun:test';
import { resolveLocation, LocationError } from '../src/geo/resolver';
import { callTool, listTools } from '../src/mcp/server';

// A refusal is only useful if the agent can act on it programmatically. Prose
// in an error string forces it to parse English to find the candidates; a
// typed payload lets it branch on a stable code and read the list directly.
// The message stays human-readable too -- both audiences, one throw.

test('an ambiguous place throws a typed error, not a bare Error', () => {
  let err: unknown;
  try { resolveLocation({ place: 'San Jose' }); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(LocationError);
  const e = err as LocationError;
  expect(e.code).toBe('ambiguous_place');
  expect(e.candidates.length).toBeGreaterThan(1);
  expect(e.matched).toBeGreaterThanOrEqual(e.candidates.length);
  expect(e.message).toMatch(/ask which one/i);   // still readable
});

test('each code is distinct and stable', () => {
  const codeOf = (input: Parameters<typeof resolveLocation>[0]) => {
    try { resolveLocation(input); return null; } catch (e) { return (e as LocationError).code; }
  };
  expect(codeOf({ place: 'San Jose' })).toBe('ambiguous_place');
  expect(codeOf({ place: 'NonExistentCity999' })).toBe('unknown_place');
  expect(codeOf({ place: 'Beijing', longitude: 116 })).toBe('incomplete_coordinates');
});

test('candidates carry identifying fields only -- no ranking signal', () => {
  let e!: LocationError;
  try { resolveLocation({ place: 'San Jose' }); } catch (err) { e = err as LocationError; }
  for (const c of e.candidates) {
    expect(Object.keys(c).sort()).toEqual(
      ['country', 'latitude', 'longitude', 'name', 'province', 'timezone']
    );
  }
});

test('the MCP layer emits the payload as JSON, not prose', async () => {
  const r = await callTool('calculate_natal', {
    solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 20, minute: 0 },
    place: 'San Jose',
  }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: e.message }] }));
  const payload = JSON.parse((r as { content: { text: string }[] }).content[0].text);
  expect(payload.code).toBe('ambiguous_place');
  expect(Array.isArray(payload.candidates)).toBe(true);
  expect(payload.matched).toBeGreaterThan(0);
  expect(payload.message).toBeDefined();
});

// --------------------------------------------------- sequencing guidance

test('the place field tells the agent to settle ambiguity BEFORE charting', async () => {
  const natal = (await listTools()).find((t) => t.name === 'calculate_natal')!;
  const place = (natal.inputSchema as { properties: Record<string, { description: string }> })
    .properties.place.description;
  expect(place).toMatch(/lookup_location/);
  expect(place).toMatch(/refus|reject/i);
});

test('lookup_location tells the agent to ASK rather than pick', async () => {
  const lookup = (await listTools()).find((t) => t.name === 'lookup_location')!;
  expect(lookup.description).toMatch(/ask/i);
  expect(lookup.description).toMatch(/do not (pick|choose|assume)/i);
  expect(lookup.description).toMatch(/before/i);
});

// ------------------------------------------- the last mile: presentation

test('the chart tools tell the agent not to collapse disclosed uncertainty', async () => {
  // Everything this server does to report uncertainty honestly is undone if
  // the model reading the JSON narrates "your Ascendant is Sagittarius" from
  // a candidate list. An LLM collapsing `["射手","摩羯"]` into one value costs
  // it nothing -- fluent, confident prose is the default. The instruction has
  // to be in the tool description, where the model actually reads it.
  for (const name of ['calculate_natal', 'calculate_synastry', 'calculate_transits']) {
    const tool = (await listTools()).find((t) => t.name === name)!;
    expect(tool.description).toMatch(/candidate/i);
    expect(tool.description).toMatch(/do not (pick|choose|collapse)|present (all|both)|report (all|both)/i);
  }
});

test('omitted fields are explained as omitted, not silently missing', async () => {
  const natal = (await listTools()).find((t) => t.name === 'calculate_natal')!;
  expect(natal.description).toMatch(/diagnostics\.omitted/);
});
