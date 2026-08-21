import { expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'fs';

const built = existsSync('dist/index.js');

test.skipIf(!built)('the bundle carries a node shebang', () => {
  expect(readFileSync('dist/index.js', 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
});

test.skipIf(!built)('data-carrying packages stay external, not inlined', () => {
  // Both geo-tz and city-timezones ship megabytes of data that they read from
  // their own package directory at runtime. Bundling either one rebases the
  // paths and bloats the artifact.
  //
  // Assert the INTENT (size), not a particular identifier. An earlier version
  // of this test asserted the bundle did not contain the string "cityMapping"
  // -- which is a city-timezones export, not a geo-tz one, and is a plain
  // property access that no minifier can rename. That assertion was
  // unsatisfiable by any correct implementation and pushed production code
  // into loading the dependency's internal JSON path to appease it.
  const js = readFileSync('dist/index.js', 'utf8');
  expect(js).toContain('geo-tz');
  expect(js).toContain('city-timezones');

  // city-timezones' data file alone is ~1.6 MB; geo-tz's is far larger.
  // A bundle under 1 MB proves neither was inlined.
  expect(statSync('dist/index.js').size).toBeLessThan(1_000_000);
});

test.skipIf(!built)('the built server answers a real MCP call under plain node', async () => {
  const proc = Bun.spawn(['node', 'dist/index.js'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const send = (o: unknown) => proc.stdin.write(`${JSON.stringify(o)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize',
         params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  await Bun.sleep(700);
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call',
         params: { name: 'lookup_location', arguments: { query: 'Beijing' } } });
  await Bun.sleep(1500);
  proc.kill();
  const out = await new Response(proc.stdout).text();
  expect(out).toContain('Asia/Shanghai');
}, 15000);

test('NOTICE credits auseklis with its MIT text', () => {
  const n = readFileSync('NOTICE', 'utf8');
  expect(n).toContain('auseklis');
  expect(n).toContain('Permission is hereby granted');
});
