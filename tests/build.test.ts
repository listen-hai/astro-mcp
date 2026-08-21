import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';

const built = existsSync('dist/index.js');

test.skipIf(!built)('the bundle carries a node shebang', () => {
  expect(readFileSync('dist/index.js', 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
});

test.skipIf(!built)('geo-tz stays external -- inlining it breaks its __dirname data reads', () => {
  const js = readFileSync('dist/index.js', 'utf8');
  expect(js).toContain('geo-tz');
  expect(js).not.toContain('cityMapping');
});

test('NOTICE credits auseklis with its MIT text', () => {
  const n = readFileSync('NOTICE', 'utf8');
  expect(n).toContain('auseklis');
  expect(n).toContain('Permission is hereby granted');
});
