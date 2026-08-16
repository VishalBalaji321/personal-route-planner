import {
  DEFAULT_MAX_BIKE_MINUTES,
  MIN_BIKE_TO_STATION_METERS,
  fullBikeMinutesFor,
  haversineMeters,
} from "./config";
import { fetchEfaTrips, type EfaTrip } from "./efa";
import type { EfaFetchOptions } from "./efa";
import type {
  AccessMode,
  CommuteOption,
  CommuteResponse,
  Leg,
  PlaceSpec,
  TransitLeg,
  WeatherSnapshot,
} from "./types";

export type TripFetcher = (opts: EfaFetchOptions) => Promise<EfaTrip[]>;

export interface PlanOptions {
  /** Cap on total biking minutes per option; longer bike options are dropped. */
  maxBikeMinutes?: number;
  /** Injectable trip fetcher (for tests). */
  fetchTrips?: TripFetcher;
}

interface AccessInfo {
  mode: AccessMode;
  minutes: number;
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

function optionTitle(legs: Leg[]): string {
  const transit = legs.filter((l): l is TransitLeg => l.type === "transit");
  if (transit.length === 0) return "Transit";
  return transit.map((l) => (l.number ? l.number : l.product)).join(" > ");
}

function tripDelays(legs: Leg[]): { hasDelay: boolean; total: number } {
  let total = 0;
  let hasDelay = false;
  for (const l of legs) {
    if (l.type !== "transit") continue;
    total += l.delayMin;
    if (l.delayMin !== 0) hasDelay = true;
  }
  return { hasDelay, total };
}

/** Coordinates of a place, falling back to its primary station. */
export function placeCoords(p: PlaceSpec): { lat: number; lon: number } | null {
  if (p.lat != null && p.lon != null) return { lat: p.lat, lon: p.lon };
  const s = p.stations[0];
  if (s) return { lat: s.lat, lon: s.lon };
  return null;
}

/**
 * Assemble and rank all commute options for a direction, given the weather
 * verdict and the current time. Every candidate access/egress station pair is
 * tried (realtime MVV EFA journeys) and the quickest door-to-door options win.
 *
 * Bike rules:
 * - bike-to-station at the origin for any station > MIN_BIKE_TO_STATION_METERS
 * - bike egress only when the destination place is marked home
 * - full end-to-end bike only when the origin place is marked home
 */
export async function planCommute(
  from: PlaceSpec,
  to: PlaceSpec,
  now: Date,
  weather: WeatherSnapshot,
  opts: PlanOptions = {},
): Promise<{ options: CommuteOption[]; errors: string[] }> {
  const errors: string[] = [];
  const options: CommuteOption[] = [];

  const maxBikeMinutes = opts.maxBikeMinutes ?? DEFAULT_MAX_BIKE_MINUTES;
  const fetchTrips = opts.fetchTrips ?? fetchEfaTrips;

  for (const originStation of from.stations) {
    const accessModes: AccessInfo[] = [{ mode: "walk", minutes: originStation.walkMin }];
    if (
      from.isHome &&
      weather.bikeAllowed &&
      originStation.distanceMeters > MIN_BIKE_TO_STATION_METERS &&
      originStation.bikeMin <= maxBikeMinutes
    ) {
      accessModes.push({ mode: "bike", minutes: originStation.bikeMin });
    }

    for (const access of accessModes) {
      const leaveEarliest = addMinutes(now, access.minutes);

      for (const destStation of to.stations) {
        let trips: EfaTrip[];
        try {
          trips = await fetchTrips({
            originStationId: originStation.stopId,
            destStationId: destStation.stopId,
            leaveEarliest,
            trips: 4,
          });
        } catch (err) {
          errors.push(
            `EFA ${originStation.stopId}->${destStation.stopId}: ${(err as Error).message}`,
          );
          continue;
        }

        for (const trip of trips) {
          if (trip.realtimeDeparture.getTime() < leaveEarliest.getTime()) continue;

          const leaveAt = addMinutes(trip.realtimeDeparture, -access.minutes);
          if (leaveAt.getTime() < now.getTime()) continue;

          const { hasDelay, total } = tripDelays(trip.legs);

          const egressModes: AccessInfo[] = [{ mode: "walk", minutes: destStation.walkMin }];
          if (
            to.isHome &&
            weather.bikeAllowed &&
            destStation.distanceMeters > MIN_BIKE_TO_STATION_METERS &&
            destStation.bikeMin <= maxBikeMinutes
          ) {
            egressModes.push({ mode: "bike", minutes: destStation.bikeMin });
          }

          for (const egress of egressModes) {
            const arriveAt = addMinutes(trip.realtimeArrival, egress.minutes);
            const totalMin = Math.round((arriveAt.getTime() - leaveAt.getTime()) / 60_000);
            options.push({
              kind: "transit",
              title: optionTitle(trip.legs),
              totalMin,
              leaveAt,
              arriveAt,
              originAccess: { mode: access.mode, minutes: access.minutes },
              egress: { mode: egress.mode, minutes: egress.minutes },
              legs: trip.legs,
              hasDelay,
              totalDelayMin: total,
              realtimeArrival: true,
              transitDurationMin: trip.durationMin,
            });
          }
        }
      }
    }
  }

  // Full end-to-end cycling, only from a place marked home.
  const coords = placeCoords(from);
  const toCoords = placeCoords(to);
  if (
    from.isHome &&
    weather.bikeAllowed &&
    coords &&
    toCoords
  ) {
    const km = haversineMeters(coords.lat, coords.lon, toCoords.lat, toCoords.lon) / 1000;
    const minutes = fullBikeMinutesFor(km);
    if (minutes <= maxBikeMinutes) {
      options.push({
        kind: "bike",
        title: "Bike all the way",
        totalMin: minutes,
        leaveAt: now,
        arriveAt: addMinutes(now, minutes),
        originAccess: { mode: "bike", minutes },
        egress: { mode: "bike", minutes: 0 },
        legs: [],
        hasDelay: false,
        totalDelayMin: 0,
        realtimeArrival: false,
      });
    }
  }

  // Rank by arrival time (the "quickest" goal), tie-break by total time.
  options.sort((a, b) => {
    const d = a.arriveAt.getTime() - b.arriveAt.getTime();
    if (d !== 0) return d;
    return a.totalMin - b.totalMin;
  });

  // Deduplicate identical options (same departure + access + egress).
  const seen = new Set<string>();
  const deduped: CommuteOption[] = [];
  for (const o of options) {
    const key = `${o.leaveAt.getTime()}|${o.arriveAt.getTime()}|${o.originAccess.mode}|${o.egress.mode}|${o.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(o);
  }

  return { options: deduped.slice(0, 8), errors };
}

export function buildResponse(
  from: PlaceSpec,
  to: PlaceSpec,
  generatedAt: Date,
  queryFor: Date,
  startTime: string | null,
  maxBikeMinutes: number,
  weather: WeatherSnapshot,
  options: CommuteOption[],
  errors: string[],
): CommuteResponse {
  return {
    generatedAt: generatedAt.toISOString(),
    queryFor: queryFor.toISOString(),
    startTime,
    maxBikeMinutes,
    from: from.id,
    to: to.id,
    fromName: from.name,
    toName: to.name,
    weather,
    options,
    errors,
  };
}
