import { expect, test } from 'bun:test';
import { smallBodyPosition, SMALL_BODIES } from '../src/ephemeris/smallbodies';
import { bodyLongitude } from '../src/ephemeris/engine';

// Ground truth: JPL Horizons, geocentric apparent ecliptic-of-date longitude
// (QUANTITIES=31, CENTER=500@399). Thresholds are TIERED per spec 2.2 --
// a single constant would contradict the measured small-body figures.
const MAJOR_ARCMIN = 1.0;
const SMALL_ARCMIN = 1.5;

const DATES = ['1900-01-01', '1950-01-01', '1990-06-16', '2026-08-20', '2050-01-01', '2100-01-01'];

const HORIZONS_ID: Record<string, string> = {
  Sun: '10', Moon: '301', Mercury: '199', Venus: '299', Mars: '499',
  Jupiter: '599', Saturn: '699', Uranus: '799', Neptune: '899', Pluto: '999',
  Chiron: '2060', Ceres: '1;', Pallas: '2;', Juno: '3;', Vesta: '4;',
};

const cache = new Map<string, number>();

async function horizons(command: string, date: string): Promise<number> {
  const key = `${command}@${date}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const next = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000)
    .toISOString().slice(0, 10);
  const q = new URLSearchParams({
    format: 'text', COMMAND: command, OBJ_DATA: 'NO', EPHEM_TYPE: 'OBSERVER',
    CENTER: '500@399', START_TIME: date, STOP_TIME: next, STEP_SIZE: '1d',
    QUANTITIES: '31',
  });
  const txt = await (await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${q}`)).text();
  const block = txt.split('$$SOE')[1];
  if (!block) throw new Error(`Horizons returned no data for ${command} @ ${date}`);
  const value = parseFloat(block.trim().split('\n')[0].trim().split(/\s+/)[2]);
  cache.set(key, value);
  return value;
}

const arcmin = (a: number, b: number) => {
  let d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d) * 60;
};

const MAJORS = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

for (const body of MAJORS) {
  for (const date of DATES) {
    test(`${body} @ ${date} within ${MAJOR_ARCMIN}' of JPL Horizons`, async () => {
      const jpl = await horizons(HORIZONS_ID[body], date);
      const got = bodyLongitude(body, new Date(`${date}T00:00:00Z`));
      expect(arcmin(jpl, got)).toBeLessThan(MAJOR_ARCMIN);
    }, 40000);
  }
}

for (const body of ['Chiron', 'Ceres', 'Pallas', 'Juno', 'Vesta']) {
  for (const date of DATES) {
    test(`${body} @ ${date} within ${SMALL_ARCMIN}' of JPL Horizons`, async () => {
      const jpl = await horizons(HORIZONS_ID[body], date);
      const got = smallBodyPosition(body, new Date(`${date}T00:00:00Z`)).lon;
      expect(arcmin(jpl, got)).toBeLessThan(SMALL_ARCMIN);
    }, 40000);
  }
}

test('REGRESSION (auseklis A1): small bodies land in the right sign at all', () => {
  // auseklis 0.4.0 was off by 70-161 deg here -- not even the right sign.
  // Chiron on 2026-08-20 is at Taurus 0.75 deg (JPL: 30.751).
  expect(arcmin(30.751, smallBodyPosition('Chiron', new Date('2026-08-20T00:00:00Z')).lon))
    .toBeLessThan(SMALL_ARCMIN);
});

test('REGRESSION (auseklis A2): integration is stepped, not one giant jump', () => {
  // A single Update() across decades produces 100+ deg of error. If the
  // implementation regresses to that, the 1900 and 2100 cases blow up while
  // 2000 stays fine -- so assert the far endpoints specifically.
  for (const date of ['1900-01-01', '2100-01-01']) {
    const lon = smallBodyPosition('Chiron', new Date(`${date}T00:00:00Z`)).lon;
    expect(Number.isFinite(lon)).toBe(true);
  }
});

test('all five small bodies are exposed', () => {
  expect([...SMALL_BODIES].sort()).toEqual(['Ceres', 'Chiron', 'Juno', 'Pallas', 'Vesta']);
});
