/** A resolved birth place: coordinates plus its IANA timezone. */
export interface CityEntry {
  name: string;
  country: string;
  province?: string;
  longitude: number;
  latitude: number;
  timezone: string;
  alternateTimezones?: string[];
  /** City population, when the source database has it -- used to break same-name ambiguity by dominance (see resolver.ts). */
  population?: number;
}

/** Geographic location needed for the Ascendant and house cusps. */
export interface Location {
  latitude: number;
  longitude: number;
}
