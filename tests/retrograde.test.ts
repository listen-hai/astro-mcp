import { expect, test } from 'bun:test';
import { findRetrograde } from '../src/core/retrograde';

// "水逆" is by far the most widely recognised astrological concept in Chinese
// online culture, and needs no birth data at all -- just a body and a window.

test('Mercury retrogrades three or four times a year', () => {
  const r = findRetrograde({ body: 'Mercury', from: { year: 2026, month: 1, day: 1 }, to: { year: 2026, month: 12, day: 31 } } as never);
  expect(r.periods.length).toBeGreaterThanOrEqual(3);
  expect(r.periods.length).toBeLessThanOrEqual(4);
});

test('each period has a station-retrograde and a station-direct instant, in order', () => {
  const r = findRetrograde({ body: 'Mercury', from: { year: 2026, month: 1, day: 1 }, to: { year: 2026, month: 12, day: 31 } } as never);
  for (const p of r.periods) {
    expect(new Date(p.startsUtc).getTime()).toBeLessThan(new Date(p.endsUtc).getTime());
    // Mercury's retrograde lasts roughly three weeks
    const days = (new Date(p.endsUtc).getTime() - new Date(p.startsUtc).getTime()) / 86400000;
    expect(days).toBeGreaterThan(15);
    expect(days).toBeLessThan(30);
  }
});

test('the body is genuinely retrograde inside a reported window and direct outside it', async () => {
  const { bodySpeed } = await import('../src/ephemeris/engine');
  const r = findRetrograde({ body: 'Mercury', from: { year: 2026, month: 1, day: 1 }, to: { year: 2026, month: 12, day: 31 } } as never);
  const p = r.periods[0];
  const mid = new Date((new Date(p.startsUtc).getTime() + new Date(p.endsUtc).getTime()) / 2);
  expect(bodySpeed('Mercury', mid)).toBeLessThan(0);
  const before = new Date(new Date(p.startsUtc).getTime() - 5 * 86400000);
  expect(bodySpeed('Mercury', before)).toBeGreaterThan(0);
});

test('the Sun and Moon never retrograde and are refused rather than returning nothing', () => {
  for (const body of ['Sun', 'Moon']) {
    expect(() => findRetrograde({ body, from: { year: 2026, month: 1, day: 1 }, to: { year: 2026, month: 12, day: 31 } } as never))
      .toThrow(/never retrograde|Sun|Moon/i);
  }
});

test('the outer planets retrograde once a year, for months at a time', () => {
  const r = findRetrograde({ body: 'Saturn', from: { year: 2026, month: 1, day: 1 }, to: { year: 2026, month: 12, day: 31 } } as never);
  expect(r.periods).toHaveLength(1);
  const days = (new Date(r.periods[0].endsUtc).getTime() - new Date(r.periods[0].startsUtc).getTime()) / 86400000;
  expect(days).toBeGreaterThan(100);
});

test('each period reports the sign it happens in -- what people actually ask', () => {
  const r = findRetrograde({ body: 'Mercury', from: { year: 2026, month: 1, day: 1 }, to: { year: 2026, month: 12, day: 31 } } as never);
  for (const p of r.periods) {
    expect(typeof p.startSign).toBe('string');
    expect(p.startSign.length).toBeGreaterThan(0);
  }
});

test('a window longer than five years is refused rather than grinding', () => {
  expect(() => findRetrograde({ body: 'Mercury', from: { year: 2000, month: 1, day: 1 }, to: { year: 2026, month: 1, day: 1 } } as never))
    .toThrow(/range|window|too long/i);
});

test('a nonexistent window date is refused, not silently rolled forward', () => {
  expect(() => findRetrograde({
    body: 'Mercury', from: { year: 2026, month: 2, day: 30 }, to: { year: 2026, month: 12, day: 31 },
  } as never)).toThrow(/does not exist|invalid date/i);
});
