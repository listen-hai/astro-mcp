import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import pkg from '../package.json';

test('package metadata matches spec constraints', () => {
  expect(pkg.name).toBe('@lhk714/astro-mcp');
  expect(pkg.license).toBe('MIT');
  expect(pkg.bin['astro-mcp']).toBe('./dist/index.js');
  expect(pkg.dependencies['astronomy-engine']).toBeDefined();
  expect(pkg.dependencies['geo-tz']).toBeDefined();
});

test('server module exports runServer', async () => {
  const mod = await import('../src/mcp/server');
  expect(typeof mod.runServer).toBe('function');
});

test('NOTICE credits auseklis (vendored under MIT)', () => {
  expect(existsSync('NOTICE')).toBe(true);
  const n = readFileSync('NOTICE', 'utf8');
  expect(n).toContain('auseklis');
  expect(n).toContain('MIT License');
});

test('build script keeps geo-tz external (it reads data via __dirname)', () => {
  expect(readFileSync('scripts/build.ts', 'utf8')).toContain("external: ['geo-tz']");
});
