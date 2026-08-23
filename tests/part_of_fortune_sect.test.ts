import { describe, it, expect } from 'bun:test';
import { computeChart } from '../src/core/chart';

const AT = (hour: number, partOfFortune?: string) =>
  computeChart({
    solarDate: { year: 1993, month: 5, day: 20 },
    clockTime: { hour, minute: 0 },
    latitude: 39.14, longitude: 117.18, timezone: 'Asia/Shanghai',
    ...(partOfFortune ? { partOfFortune } : {}),
  } as never) as never as {
    partOfFortune: { longitude: number; dayChart: boolean };
    diagnostics: { partOfFortune: string };
  };

describe('the Part of Fortune sect rule is the caller\'s, not this file\'s', () => {
  it('agrees with itself on every day chart', () => {
    // Both readings use Asc + Moon - Sun by day. A day chart that moved would
    // mean the switch is doing something other than what it claims.
    for (const hour of [9, 12, 15]) {
      const a = AT(hour), b = AT(hour, 'never_reverse');
      expect(a.partOfFortune.dayChart, `${hour}:00 should be a day chart`).toBe(true);
      expect(b.partOfFortune.longitude, `${hour}:00`).toBeCloseTo(a.partOfFortune.longitude, 9);
    }
  });

  it('parts ways on a night chart, by enough to change the sign', () => {
    const a = AT(23), b = AT(23, 'never_reverse');
    expect(a.partOfFortune.dayChart).toBe(false);
    const gap = Math.abs(a.partOfFortune.longitude - b.partOfFortune.longitude);
    expect(Math.min(gap, 360 - gap)).toBeGreaterThan(1);
  });

  it('echoes the rule that produced the longitude', () => {
    // Without this the two readings are indistinguishable in the output: a
    // reversed and an unreversed longitude are both just a longitude.
    expect(AT(23).diagnostics.partOfFortune).toBe('reverse_at_night');
    expect(AT(23, 'never_reverse').diagnostics.partOfFortune).toBe('never_reverse');
    expect(AT(12).diagnostics.partOfFortune).toBe('reverse_at_night');
  });

  it('never_reverse really is the day formula, not a relabelled default', () => {
    // Asc + Moon - Sun, computed straight from the chart's own reported values.
    const night = AT(23, 'never_reverse') as never as {
      partOfFortune: { longitude: number };
      angles: { ascendant: { longitude: number } };
      positions: { body: string; longitude: number }[];
    };
    const lon = (name: string) => night.positions.find(p => p.body === name)!.longitude;
    const expected = ((night.angles.ascendant.longitude + lon('月亮') - lon('太阳')) % 360 + 360) % 360;
    expect(night.partOfFortune.longitude).toBeCloseTo(expected, 6);
  });
});
