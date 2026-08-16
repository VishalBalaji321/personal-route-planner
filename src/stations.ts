import {
  MAX_STATIONS_PER_PLACE,
  bikeMinutesFor,
  haversineMeters,
  walkMinutesFor,
} from "./config";
import { searchStops, stopInfo } from "./efa";
import type { StationSpec } from "./types";

export interface Bindings {
  ASSETS: Fetcher;
}

/** A row in `public/data/stops.json`: [name, lat, lon]. */
type StopRow = [string, number, number];

let stopsCache: StopRow[] | null = null;

/** Load the bundled MVV stop list once and cache it. */
async function loadStops(env: Bindings): Promise<StopRow[]> {
  if (stopsCache) return stopsCache;
  const res = await env.ASSETS.fetch(new URL("/data/stops.json", "https://worker.local"));
  if (!res.ok) throw new Error(`stops list unavailable (HTTP ${res.status})`);
  const data = (await res.json()) as Array<{ name: string; lat: number; lon: number }>;
  stopsCache = data.map((s) => [s.name, s.lat, s.lon]);
  return stopsCache;
}

/**
 * Resolve the nearest EFA stops to a WGS84 point.
 * Steps: nearest stops by name (bundled OSM list) → EFA stopfinder for the
 * numeric stop id (with DM fallback for coordinates) → return closest matches.
 * An EFA candidate is accepted when its coordinates are close to the OSM stop
 * node's coordinates (same stop, tolerating large venues).
 */
export async function nearestStations(
  lat: number,
  lon: number,
  env: Bindings,
  limit: number = MAX_STATIONS_PER_PLACE,
): Promise<StationSpec[]> {
  const stops = await loadStops(env);

  // Nearest rows by name (keep closest coords per distinct name).
  const bestByName = new Map<string, { dist: number; lat: number; lon: number }>();
  for (const [name, slat, slon] of stops) {
    const d = haversineMeters(lat, lon, slat, slon);
    const cur = bestByName.get(name);
    if (!cur || d < cur.dist) bestByName.set(name, { dist: d, lat: slat, lon: slon });
  }

  const nearestNames = [...bestByName.entries()]
    .sort((a, b) => a[1].dist - b[1].dist)
    .slice(0, Math.max(limit, 4))
    .map(([name, coords]) => ({ name, ...coords }));

  const found = new Map<string, StationSpec>();
  for (const entry of nearestNames) {
    if (found.size >= limit) break;
    let candidates;
    try {
      candidates = await searchStops(entry.name);
    } catch {
      continue;
    }
    if (candidates.length === 0) continue;

    // Prefer the candidate whose EFA coordinates are closest to the OSM node.
    let pick = candidates[0];
    let pickMatch = Infinity;
    for (const c of candidates) {
      if (c.lat == null || c.lon == null) continue;
      const m = haversineMeters(entry.lat, entry.lon, c.lat, c.lon);
      if (m < pickMatch) {
        pickMatch = m;
        pick = c;
      }
    }

    // List results omit coordinates — resolve the picked stop via DM.
    if (pick.lat == null || pick.lon == null || !Number.isFinite(pickMatch)) {
      try {
        const info = await stopInfo(pick.stopId);
        if (info) {
          pick = { stopId: info.stopId, name: info.name, lat: info.lat, lon: info.lon };
          pickMatch = haversineMeters(entry.lat, entry.lon, info.lat, info.lon);
        }
      } catch {
        continue;
      }
    }

    // Not the same stop → skip (avoids e.g. "Marienplatz" in other cities).
    if (pick.lat == null || pick.lon == null || pickMatch > 800) continue;
    if (found.has(pick.stopId)) continue;

    const d = haversineMeters(lat, lon, pick.lat, pick.lon);
    found.set(pick.stopId, {
      stopId: pick.stopId,
      label: pick.name,
      lat: pick.lat,
      lon: pick.lon,
      walkMin: walkMinutesFor(d),
      bikeMin: bikeMinutesFor(d),
      distanceMeters: Math.round(d),
    });
  }

  return [...found.values()].sort((a, b) => a.distanceMeters - b.distanceMeters);
}
