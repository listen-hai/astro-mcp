/** A resolved birth place: coordinates plus its IANA timezone. */
export interface CityEntry {
  name: string;
  country: string;
  province?: string;
  longitude: number;
  latitude: number;
  timezone: string;
  alternateTimezones?: string[];
}

/** Geographic location needed for the Ascendant and house cusps. */
export interface Location {
  latitude: number;
  longitude: number;
}
