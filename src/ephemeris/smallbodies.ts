import * as AstronomyImport from 'astronomy-engine';
import { eclipticOfDate, eclipticToEquatorial } from './frames';
import seedsData from './seeds.json';

const A = ((AstronomyImport as unknown as { default?: typeof AstronomyImport }).default ??
  AstronomyImport) as typeof AstronomyImport;

export const SMALL_BODIES = ['Chiron', 'Ceres', 'Pallas', 'Juno', 'Vesta'] as const;
export type SmallBodyName = (typeof SMALL_BODIES)[number];

// Per GravitySimulator's own docs: "bodies that stay in the outer Solar
// System and move slowly can use larger time steps [...] bodies that pass
// into the inner Solar System and move faster will need a smaller time
// step." Measured against JPL Horizons across 1900-2100 (spec 6.1/6.2):
// Chiron (perihelion ~8.4 AU, ~50yr period) holds < 1.2' at a 4-day step,
// but the four inner main-belt asteroids (~2-3 AU, ~4yr period) need a much
// finer step to stay under the same threshold -- at 4 days they were off by
// as much as 2 degrees; 0.25 days brings the worst case under 1 arcminute.
const STEP_DAYS_OUTER = 4;
const STEP_DAYS_INNER = 0.25;
function stepDaysFor(name: string): number {
  return name === 'Chiron' ? STEP_DAYS_OUTER : STEP_DAYS_INNER;
}

const C_AU_PER_DAY = 173.144632674; // speed of light, AU/day

interface Seed {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

// Seeds are stored every 20 years (1900..2100) instead of a single J2000
// epoch. Starting from the nearest one caps the integration distance at 10
// years instead of up to 100 -- roughly 10x fewer GravitySimulator steps,
// and shorter integration is also more accurate.
/**
 * Exported for tests: the gap, in years, between a date and the seed epoch the
 * integration will actually start from. This is the property that matters --
 * integrating a 1900 chart all the way from J2000 was the original 4.7 s bug,
 * and a timing assertion cannot pin it down portably (CI hardware varies too
 * much). The integration distance is hardware-independent and IS the defect.
 */
export function integrationSpanYears(name: string, date: Date): number {
  const { ref } = nearestEpochOf(name, date);
  return Math.abs(date.getTime() - ref.date.getTime()) / (365.25 * 86400000);
}

function nearestEpochOf(name: string, date: Date): { ref: AstronomyImport.AstroTime; seed: Seed } {
  const epochs = (seedsData as unknown as Record<string, Record<string, Seed>>)[name];
  if (!epochs) throw new Error(`No JPL seed for small body "${name}". Known bodies: ${SMALL_BODIES.join(', ')}`);
  const t1 = date.getTime();
  let bestIso = '';
  let bestDiff = Infinity;
  for (const iso of Object.keys(epochs)) {
    const diff = Math.abs(new Date(iso).getTime() - t1);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIso = iso;
    }
  }
  return { ref: A.MakeTime(new Date(bestIso)), seed: epochs[bestIso] };
}

/**
 * Builds a GravitySimulator seeded from the nearest JPL epoch and advances it
 * to `date` in fixed small steps.
 *
 * A single Update() spanning decades produces 100+ deg of error (this is
 * auseklis's A2 defect) -- the simulator's own docs call for "a small time
 * step" per Update() call. Splitting into small fixed-size increments (see
 * `stepDaysFor`) is what keeps 1900-2100 accurate; Update() itself supports
 * negative steps too, so the same loop works whether `date` is before or
 * after the chosen epoch.
 */
function integrate(name: string, date: Date): AstronomyImport.GravitySimulator {
  const { ref, seed: s } = nearestEpochOf(name, date);
  const seedVector = new A.StateVector(s.x, s.y, s.z, s.vx, s.vy, s.vz, ref);
  const sim = new A.GravitySimulator(A.Body.Sun, ref, [seedVector]);
  const t0 = ref.date.getTime();
  const t1 = date.getTime();
  const steps = Math.max(1, Math.ceil(Math.abs(t1 - t0) / 86400000 / stepDaysFor(name)));
  for (let i = 1; i <= steps; i++) {
    sim.Update(new Date(t0 + ((t1 - t0) * i) / steps));
  }
  return sim;
}

/**
 * Heliocentric position at a time near the simulator's current step. Only
 * ever called with small offsets (light-time is a couple of hours at most;
 * the speed sampling window is +/-12h), so one more Update() call here stays
 * within the "small time step" contract above.
 */
function heliocentricNear(
  sim: AstronomyImport.GravitySimulator,
  date: Date
): { x: number; y: number; z: number } {
  const [state] = sim.Update(date);
  return { x: state.x, y: state.y, z: state.z };
}

function geoVector(
  sim: AstronomyImport.GravitySimulator,
  date: Date
): AstronomyImport.Vector {
  const body = heliocentricNear(sim, date);
  const earth = A.HelioVector(A.Body.Earth, date); // geometric, not light-time corrected -- see below
  const t = A.MakeTime(date);
  return new A.Vector(body.x - earth.x, body.y - earth.y, body.z - earth.z, t);
}

function geoLongitude(sim: AstronomyImport.GravitySimulator, date: Date): number {
  const t = A.MakeTime(date);
  return eclipticOfDate(geoVector(sim, date), t).lon;
}

export function smallBodyPosition(
  name: string,
  date: Date
): { lon: number; lat: number; dec: number; speed: number } {
  const sim = integrate(name, date);
  const t = A.MakeTime(date);

  // Light-time correction: the observer (Earth) sits at `date`, but the body
  // is seen where it was `lightDays` earlier. First approximate the distance
  // geometrically, then re-evaluate the body's position back at that retarded
  // time -- this is the QUANTITIES=31 convention Horizons reports against.
  const g0 = geoVector(sim, date);
  const lightDays = g0.Length() / C_AU_PER_DAY;
  const retarded = new Date(date.getTime() - lightDays * 86400000);
  const bodyPast = heliocentricNear(sim, retarded);
  const earthNow = A.HelioVector(A.Body.Earth, date);
  const g = new A.Vector(
    bodyPast.x - earthNow.x,
    bodyPast.y - earthNow.y,
    bodyPast.z - earthNow.z,
    t
  );

  const { lon, lat } = eclipticOfDate(g, t);
  const { dec } = eclipticToEquatorial(lon, lat, t);

  const half = 12 * 3600 * 1000; // +/-0.5 day central difference, degrees/day
  const before = geoLongitude(sim, new Date(date.getTime() - half));
  const after = geoLongitude(sim, new Date(date.getTime() + half));
  let speed = after - before;
  if (speed > 180) speed -= 360;
  if (speed < -180) speed += 360;

  return { lon, lat, dec, speed };
}
