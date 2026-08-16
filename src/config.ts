import type { PlaceSpec } from "./types";

/**
 * No personal data lives here anymore: places (addresses, coordinates, chosen
 * stations) are stored in the user's browser (localStorage) and sent to the
 * API per request. This file only holds tuning constants and the *default*
 * seed places (public transit stations only — no street addresses, no home
 * coordinates) used to bootstrap the browser store on first run.
 */

/** Average walking speed used to estimate access/egress times. */
export const WALK_SPEED_KMH = 4.8;

/** Average cycling speed used to estimate bike access/full-bike times. */
export const BIKE_SPEED_KMH = 15;

/** Fixed overhead (min) for fetching the bike and getting going. */
export const BIKE_FETCH_MIN = 2;

/** Road-distance factor applied to straight-line distance. */
export const DETOUR_FACTOR = 1.3;

/** Biking to the station only makes sense beyond this distance (meters). */
export const MIN_BIKE_TO_STATION_METERS = 600;

/** Default cap on total biking time per option (minutes). */
export const DEFAULT_MAX_BIKE_MINUTES = 20;

/** Cap on how many candidate stations a place may carry. */
export const MAX_STATIONS_PER_PLACE = 3;

/**
 * Estimate walking minutes from a straight-line distance in meters.
 */
export function walkMinutesFor(distanceMeters: number): number {
  const km = (distanceMeters * DETOUR_FACTOR) / 1000;
  return Math.max(1, Math.ceil((km / WALK_SPEED_KMH) * 60));
}

/**
 * Estimate cycling minutes (including fetch overhead) from a distance.
 */
export function bikeMinutesFor(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return Infinity;
  const km = (distanceMeters * DETOUR_FACTOR) / 1000;
  return Math.max(1, Math.ceil((km / BIKE_SPEED_KMH) * 60 + BIKE_FETCH_MIN));
}

/**
 * Estimate full end-to-end cycling minutes between two points.
 * `distanceKm` is the straight-line distance in km.
 */
export function fullBikeMinutesFor(distanceKm: number): number {
  return Math.max(1, Math.ceil(((distanceKm * DETOUR_FACTOR) / BIKE_SPEED_KMH) * 60));
}

/** Straight-line distance in meters between two WGS84 points (haversine). */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Default places seeded into the browser store on first run. These carry no
 * street addresses or home coordinates — only the user's known stations and
 * access times, so nothing personal is committed to the repo.
 */
export const SEED_PLACES: PlaceSpec[] = [
  {
    id: "seed-home",
    name: "Home",
    address: "",
    isHome: true,
    stations: [
      {
        stopId: "91000300",
        label: "München, Moosach Bf",
        lat: 48.1808,
        lon: 11.5076,
        walkMin: 12,
        bikeMin: 6,
        distanceMeters: 1069,
      },
    ],
  },
  {
    id: "seed-work1",
    name: "BMW Garching",
    address: "",
    isHome: false,
    stations: [
      {
        stopId: "1002009",
        label: "Hochbrück (Obb), Carl-von-Linde-Straße",
        lat: 48.2503,
        lon: 11.6085,
        walkMin: 5,
        bikeMin: Infinity,
        distanceMeters: 170,
      },
      {
        stopId: "1002012",
        label: "Hochbrück (Obb), Voithstraße",
        lat: 48.2504,
        lon: 11.6129,
        walkMin: 10,
        bikeMin: Infinity,
        distanceMeters: 400,
      },
    ],
  },
  {
    id: "seed-work2",
    name: "BMW FIZ",
    address: "",
    isHome: false,
    stations: [
      {
        stopId: "91000760",
        label: "München, Am Hart",
        lat: 48.1967,
        lon: 11.5718,
        walkMin: 8,
        bikeMin: Infinity,
        distanceMeters: 612,
      },
    ],
  },
];
