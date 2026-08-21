import { find as findTimezones } from 'geo-tz';
import cityTimezones, { CityTimezoneEntry } from 'city-timezones';
import { CityEntry } from '../types';

/**
 * Normalizes query string for fuzzy search:
 * - Decomposes diacritics via Unicode NFD (e.g. "São Paulo" -> "Sao Paulo", "Reykjavík" -> "Reykjavik")
 * - Removes non-spacing marks, punctuation, quotes, and whitespace.
 */
function normalizeQuery(q: string): string {
  return q
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s,\-_\.']/g, '')
    .trim();
}

/**
 * Converts a city-timezones entry to our CityEntry format, using geo-tz (real
 * timezone-boundary polygons, 1970-era dataset) to ensure authoritative IANA
 * timezone resolution. Coordinates that fall inside more than one timezone
 * boundary (border overlaps, or genuine dual civil-time regions) yield more
 * than one candidate; `alternateTimezones` carries the rest.
 *
 * Picking the default among candidates is domain knowledge, not geography:
 * China has used a single civil time zone (Beijing time, Asia/Shanghai, UTC+8)
 * nationwide since 1949 and mainland birth records use it, so when Asia/Shanghai
 * is among the candidates for a CN city, it wins regardless of polygon order.
 */
function toCityEntry(ct: CityTimezoneEntry): CityEntry {
  let candidates: string[];
  try {
    candidates = findTimezones(ct.lat, ct.lng);
  } catch {
    candidates = [];
  }
  if (candidates.length === 0) {
    candidates = [ct.timezone];
  }

  const timezone =
    ct.iso2 === 'CN' && candidates.includes('Asia/Shanghai')
      ? 'Asia/Shanghai'
      : candidates[0];
  const alternateTimezones = candidates.filter(tz => tz !== timezone);

  return {
    name: ct.city,
    country: ct.iso2,
    province: ct.province,
    longitude: ct.lng,
    latitude: ct.lat,
    timezone,
    alternateTimezones: alternateTimezones.length > 0 ? alternateTimezones : undefined,
    population: ct.pop,
  };
}

/**
 * Searches the global city-timezones database (7,329 cities, 227 countries).
 * Supports English city names, with fuzzy matching on city and city_ascii fields,
 * prioritized by city population descending.
 */
export function lookupCity(query: string): CityEntry[] {
  if (!query || !query.trim()) return [];

  const norm = normalizeQuery(query);
  const db: CityTimezoneEntry[] = cityTimezones.cityMapping;

  const exactMatches: CityTimezoneEntry[] = [];
  const partialMatches: CityTimezoneEntry[] = [];

  for (const city of db) {
    const nameNorm = normalizeQuery(city.city);
    const asciiNorm = normalizeQuery(city.city_ascii);
    const provinceNorm = normalizeQuery(city.province || '');
    const countryNorm = normalizeQuery(city.country || '');

    // 1. Exact match on city name or ASCII name
    if (nameNorm === norm || asciiNorm === norm) {
      exactMatches.push(city);
      continue;
    }

    // 2. "City, State/Province" style query (e.g. "San Francisco, CA" or "Tacoma, WA")
    if (norm.includes(asciiNorm) || norm.includes(nameNorm)) {
      const remainder = norm.replace(asciiNorm, '').replace(nameNorm, '');
      if (
        remainder.length === 0 ||
        provinceNorm.includes(remainder) ||
        countryNorm.includes(remainder) ||
        (city.state_ansi && normalizeQuery(city.state_ansi) === remainder)
      ) {
        exactMatches.push(city);
        continue;
      }
    }

    // 3. Partial / prefix match
    if (
      nameNorm.includes(norm) ||
      asciiNorm.includes(norm) ||
      (norm.length >= 3 && (nameNorm.startsWith(norm) || asciiNorm.startsWith(norm)))
    ) {
      partialMatches.push(city);
    }
  }

  // Sort by population descending so major cities take precedence
  const rawResults = exactMatches.length > 0 ? exactMatches : partialMatches;
  rawResults.sort((a, b) => (b.pop || 0) - (a.pop || 0));

  // Deduplicate by city name, country, and province — same-name cities within
  // one country (e.g. Springfield, MO vs Springfield, IL) must stay distinct
  // candidates rather than being silently collapsed into one.
  const seen = new Set<string>();
  const results: CityEntry[] = [];

  for (const r of rawResults) {
    const key = `${r.city}|${r.country}|${r.province}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(toCityEntry(r));
    }
  }

  return results.slice(0, 10);
}

export interface ResolvedLocation {
  longitude: number;
  timezone: string;
  latitude?: number;
  province?: string;
  placeName?: string;
  alternateTimezones?: string[];
  locationSource: 'resolved' | 'caller_supplied' | 'mixed';
  mixedWarning?: string;
}

/**
 * Resolves location according to BaziInput contract:
 * - If explicit longitude AND timezone are provided, use them directly (locationSource: 'caller_supplied').
 * - If place is provided alone, look up coordinates and IANA timezone from global database (locationSource: 'resolved').
 * - If place is provided alongside custom timezone, coordinates are resolved and timezone is overridden (locationSource: 'mixed').
 * - If place is provided alongside both longitude AND timezone, explicit values are used (locationSource: 'caller_supplied').
 * - Partial mixing (place + only longitude without timezone) is strictly rejected to prevent geographical mismatches.
 * - If same-name cities all share one timezone: auto-pick (no chart impact).
 * - If same-name cities disagree on timezone: always throw with candidate list.
 * - If place cannot be resolved, throws descriptive error.
 */
export function resolveLocation(input: {
  place?: string;
  longitude?: number;
  timezone?: string;
}): ResolvedLocation {
  const hasPlace = Boolean(input.place);
  const hasLon = input.longitude !== undefined;
  const hasTz = Boolean(input.timezone);

  // 1. Both longitude + timezone provided (with or without place) -> caller_supplied
  if (hasLon && hasTz) {
    const mixedWarning = hasPlace
      ? `Both \`place\` ("${input.place}") and explicit coordinates (\`longitude: ${input.longitude}\`, \`timezone: "${input.timezone}"\`) were provided; explicit values were used.`
      : undefined;

    return {
      longitude: input.longitude!,
      timezone: input.timezone!,
      placeName: input.place,
      locationSource: 'caller_supplied',
      mixedWarning,
    };
  }

  // 2. Place provided with longitude only (missing timezone) -> Reject partial override
  if (hasPlace && hasLon && !hasTz) {
    throw new Error(
      `Inconsistent location input: when overriding coordinates with \`longitude\` alongside \`place\` ("${input.place}"), \`timezone\` must also be explicitly provided.`
    );
  }

  // 3. Place provided (with optional timezone override)
  if (hasPlace) {
    const candidates = lookupCity(input.place!);

    if (candidates.length === 0) {
      throw new Error(
        `Could not recognize birth place "${input.place}". Please use an English city name (e.g. "Beijing", "New York", "Lagos"), or explicitly pass \`longitude\` and \`timezone\`.`
      );
    }

    if (candidates.length > 1) {
      const queryNorm = normalizeQuery(input.place!);
      const exactNameMatches = candidates.filter(c => normalizeQuery(c.name) === queryNorm);
      const sameTimezone = exactNameMatches.length > 0 &&
        exactNameMatches.every(c => c.timezone === exactNameMatches[0].timezone);

      // All exact-name matches agree on timezone. That is a genuinely safe
      // "no chart impact, pick silently" shortcut for bazi (longitude-only),
      // but NOT for a Western chart: latitude drives the Ascendant directly,
      // so same-timezone namesakes that disagree on latitude (e.g. Columbus,
      // OH at 40.0N vs Columbus, GA at 32.5N, both America/New_York) still
      // need disclosing.
      if (sameTimezone) {
        const city = candidates[0];
        const LAT_SPREAD_THRESHOLD = 1; // degrees
        const lats = exactNameMatches.map(c => c.latitude);
        const latSpread = Math.max(...lats) - Math.min(...lats);
        const latNote =
          latSpread > LAT_SPREAD_THRESHOLD
            ? `Place "${input.place}" matched multiple candidate cities sharing timezone "${city.timezone}" but ` +
              `differing in latitude by ${latSpread.toFixed(1)}°, which changes the Ascendant; picked ` +
              `"${city.name} (${city.country})". Candidates: ` +
              exactNameMatches.map(c => `${c.name} (${c.province || ''}, ${c.country}) @ ${c.latitude}°N`).join('; ')
            : undefined;

        const isAlternateTz = Boolean(input.timezone && city.alternateTimezones?.includes(input.timezone));
        const isCustomTz = Boolean(input.timezone && input.timezone !== city.timezone && !isAlternateTz);
        const locationSource: 'resolved' | 'mixed' = isCustomTz ? 'mixed' : 'resolved';
        const customTzNote = isCustomTz
          ? `Place "${input.place}" was resolved for coordinates (${city.longitude}°), but custom timezone ("${input.timezone}") was supplied by caller.`
          : undefined;
        const mixedWarning = [customTzNote, latNote].filter(Boolean).join(' ') || undefined;

        return {
          longitude: city.longitude,
          timezone: input.timezone || city.timezone,
          latitude: city.latitude,
          province: city.province,
          placeName: `${city.name} (${city.country})`,
          alternateTimezones: input.timezone ? undefined : city.alternateTimezones,
          locationSource,
          mixedWarning,
        };
      }

      // Timezones disagree, but if the top-ranked exact match's population
      // dominates every conflicting-timezone runner-up by a wide margin, the
      // ambiguity is theoretical rather than practical -- e.g. "Los Angeles"
      // (US, pop ~8.1M) vs a same-named town in Bio-Bio, Chile (pop ~135k,
      // ~60x smaller). Refusing outright would make one of the most common
      // city names in astrology charts unusable.
      //
      // Genuinely comparable same-name cities still fall through to the
      // refusal below: "Springfield" tops out at MA ~287k against MO ~181k
      // in a different zone, only ~1.6x, so the caller is asked to be more
      // specific. Verified against the shipped city-timezones data, not
      // assumed -- note that database holds only ONE Cambridge (GB), so
      // Cambridge is NOT an example of this branch.
      const DOMINANCE_RATIO = 10;
      // Guard: a query that only PARTIALLY matched (e.g. "Spring" hitting
      // Springfield/Springdale in different zones) has no exact matches at
      // all, so there is nothing to rank -- fall through to the candidate
      // list below rather than indexing an empty array.
      const top = exactNameMatches.length > 0 ? exactNameMatches[0] : undefined;
      const topPop = top?.population ?? 0;
      const runnerUp = top ? exactNameMatches.find(c => c.timezone !== top.timezone) : undefined;
      const runnerUpPop = runnerUp?.population ?? 0;
      const dominant = Boolean(top) && topPop > 0 && runnerUpPop > 0
        && topPop >= runnerUpPop * DOMINANCE_RATIO;

      if (dominant && top) {
        const isAlternateTz = Boolean(input.timezone && top.alternateTimezones?.includes(input.timezone));
        const isCustomTz = Boolean(input.timezone && input.timezone !== top.timezone && !isAlternateTz);
        const locationSource: 'resolved' | 'mixed' = isCustomTz ? 'mixed' : 'resolved';
        const dominanceNote =
          `Place "${input.place}" matched multiple candidate cities with different timezones; picked ` +
          `"${top.name} (${top.country})" (population ${Math.round(topPop).toLocaleString()}) over ` +
          `"${runnerUp!.name} (${runnerUp!.country})" (population ${Math.round(runnerUpPop).toLocaleString()}), ` +
          `a >=${DOMINANCE_RATIO}x difference. Pass explicit \`longitude\`+\`timezone\` if the smaller city was intended.`;

        return {
          longitude: top.longitude,
          timezone: input.timezone || top.timezone,
          latitude: top.latitude,
          province: top.province,
          placeName: `${top.name} (${top.country})`,
          alternateTimezones: input.timezone ? undefined : top.alternateTimezones,
          locationSource,
          mixedWarning: isCustomTz
            ? `${dominanceNote} Additionally, custom timezone ("${input.timezone}") was supplied by caller and used instead of the resolved one.`
            : dominanceNote,
        };
      }

      // Timezones disagree and no candidate dominates -> refuse and list candidates.
      // Getting the wrong timezone silently is catastrophic for a natal chart.
      // The calling AI agent can easily clarify with the user and retry.
      const listStr = candidates
        .slice(0, 5)
        .map(
          c =>
            `• ${c.name} (${c.province || ''}, ${c.country}) -> longitude: ${c.longitude}°, timezone: "${c.timezone}"`
        )
        .join('\n');
      throw new Error(
        `Place name "${input.place}" matched multiple candidate cities with different timezones; please specify more precisely (e.g. "Sydney, Australia") or explicitly provide \`longitude\` and \`timezone\`:\n${listStr}`
      );
    }

    const city = candidates[0];
    const isAlternateTz = Boolean(input.timezone && city.alternateTimezones?.includes(input.timezone));
    const isCustomTz = Boolean(input.timezone && input.timezone !== city.timezone && !isAlternateTz);
    const locationSource: 'resolved' | 'mixed' = isCustomTz ? 'mixed' : 'resolved';
    const mixedWarning = isCustomTz
      ? `Place "${input.place}" was resolved for coordinates (${city.longitude}°), but custom timezone ("${input.timezone}") was supplied by caller.`
      : undefined;

    return {
      longitude: city.longitude,
      timezone: input.timezone || city.timezone,
      latitude: city.latitude,
      province: city.province,
      placeName: `${city.name} (${city.country})`,
      alternateTimezones: input.timezone ? undefined : city.alternateTimezones,
      locationSource,
      mixedWarning,
    };
  }

  // 4. Incomplete longitude without timezone
  if (hasLon && !hasTz) {
    throw new Error(
      `Longitude (${input.longitude}) was provided but \`timezone\` (IANA timezone name) is missing. Rounding longitude to infer a timezone is strictly forbidden; please explicitly specify \`timezone\`.`
    );
  }

  throw new Error(
    'Missing birth location: please provide `place` (English city name, e.g. "Beijing", "New York", "Lagos"), or both `longitude` and `timezone`.'
  );
}
