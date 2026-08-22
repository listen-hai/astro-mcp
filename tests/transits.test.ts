import { expect, test } from 'bun:test';
import { computeTransits } from '../src/core/transits';

const NATAL = { solarDate: { year: 1993, month: 7, day: 14 }, clockTime: { hour: 11, minute: 27 }, place: 'Kunming' };
const TARGET = { solarDate: { year: 2026, month: 8, day: 21 }, clockTime: { hour: 12, minute: 0 } };

test('transiting bodies are the sky at the target instant, not at birth', () => {
  const t = computeTransits({ ...NATAL, target: TARGET } as never);
  const natalSun = t.natal.positions.find((p: { body: string }) => p.body === '太阳');
  const transitSun = t.transiting.find((p: { body: string }) => p.body === '太阳');
  expect(natalSun.sign).toBe('巨蟹');       // July birth
  expect(transitSun.sign).toBe('狮子');      // late August 2026
});

test('aspects run from the transiting sky to the natal chart, one direction only', () => {
  const t = computeTransits({ ...NATAL, target: TARGET } as never);
  expect(t.aspects.length).toBeGreaterThan(0);
  for (const a of t.aspects) {
    expect(a.transiting).toBeDefined();
    expect(a.natal).toBeDefined();
  }
});

test('omitting target defaults to now, and says so', () => {
  const t = computeTransits({ ...NATAL } as never);
  expect(t.diagnostics.targetSource).toBe('now');
  expect(new Date(t.diagnostics.targetUtc).getTime()).toBeGreaterThan(Date.UTC(2026, 0, 1));
});

test('a target before birth is refused -- it is not a transit', () => {
  expect(() => computeTransits({
    ...NATAL, target: { solarDate: { year: 1980, month: 1, day: 1 }, clockTime: { hour: 12, minute: 0 } },
  } as never)).toThrow(/before|birth/i);
});

test('house ingress is reported when the natal chart has houses', () => {
  const t = computeTransits({ ...NATAL, target: TARGET } as never);
  const withHouse = t.transiting.filter((p: { natalHouse?: number }) => p.natalHouse !== undefined);
  expect(withHouse.length).toBeGreaterThan(0);
});

test('an unknown birth time removes house ingress and angle aspects, not planet aspects', () => {
  const t = computeTransits({ solarDate: NATAL.solarDate, place: NATAL.place, target: TARGET } as never);
  expect(t.aspects.length).toBeGreaterThan(0);                     // planet-to-planet survives
  for (const p of t.transiting) expect('natalHouse' in p).toBe(false);
  for (const a of t.aspects) expect(['上升', '天顶']).not.toContain(a.natal);
  const omitted = t.diagnostics.omitted.map((o: { field: string }) => o.field);
  expect(omitted).toContain('transiting[].natalHouse');
});

test('aspects to the natal Moon are marked uncertain when the birth time is unknown', () => {
  const t = computeTransits({ solarDate: NATAL.solarDate, place: NATAL.place, target: TARGET } as never);
  for (const a of t.aspects.filter((x: { natal: string }) => x.natal === '月亮')) {
    expect(a.uncertain).toBe(true);
  }
});

test('a known time WINDOW yields natal house candidates, not nothing', () => {
  const t = computeTransits({
    ...NATAL, clockTime: undefined,
    clockTimeRange: { from: { hour: 11, minute: 15 }, to: { hour: 11, minute: 45 } },
    target: TARGET,
  } as never);
  const withCandidates = t.transiting.filter((p: { natalHouseCandidates?: number[] }) => p.natalHouseCandidates);
  expect(withCandidates.length).toBeGreaterThan(0);
  expect(t.diagnostics.omitted.map((o: { field: string }) => o.field))
    .not.toContain('transiting[].natalHouse');
});

test('a nonexistent target date is refused, exactly as the natal tool refuses one', () => {
  expect(() => computeTransits({
    ...NATAL, target: { solarDate: { year: 2026, month: 2, day: 30 }, clockTime: { hour: 12, minute: 0 } },
  } as never)).toThrow(/does not exist|invalid date/i);
});

test('south-node aspects are suppressed by default here too', () => {
  const t = computeTransits({ ...NATAL, target: TARGET } as never);
  for (const a of t.aspects) {
    expect(a.transiting).not.toBe('南交点');
    expect(a.natal).not.toBe('南交点');
  }
});
