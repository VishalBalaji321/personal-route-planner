import { searchStops } from "./efa";
import { geocode, nominatim } from "./geocode";

export interface SearchResult {
  kind: "stop" | "place" | "address";
  name: string;
  /** Coordinates may be missing for stop matches (resolve via /api/station). */
  lat?: number;
  lon?: number;
  /** Present only for kind="stop" — the EFA numeric stop id. */
  stopId?: string;
}

/**
 * Free-text search across three providers so that station names, landmarks,
 * city names and street addresses all resolve:
 * 1. EFA stopfinder (stations + POIs, gives EFA stop ids directly)
 * 2. Open-Meteo geocoding (cities / named places)
 * 3. Nominatim (street addresses)
 */
export async function searchPlaces(q: string): Promise<SearchResult[]> {
  const trimmed = q.trim();
  const results: SearchResult[] = [];
  const addressLike = /\d/.test(trimmed) || /straße|strasse|street|road|avenue|allee|weg\b/i.test(trimmed);

  let stops: Awaited<ReturnType<typeof searchStops>> = [];
  if (!addressLike) {
    try {
      stops = await searchStops(trimmed);
    } catch {
      /* stopfinder may be rate-limited; continue */
    }
  }
  const localFirst = (name: string) => {
    const value = name.toLowerCase();
    if (value.includes("münchen") || value.includes("munich")) return 0;
    if (value.includes("garching") || value.includes("hochbrück") || value.includes("moosach")) return 1;
    return 2;
  };
  stops.sort((a, b) => localFirst(a.name) - localFirst(b.name));
  for (const s of stops.slice(0, 4)) {
    results.push({ kind: "stop", name: s.name, lat: s.lat, lon: s.lon, stopId: s.stopId });
  }

  if (addressLike) {
    try {
      for (const a of await nominatim(trimmed, 3)) {
        results.push({ kind: "address", name: a.name, lat: a.lat, lon: a.lon });
      }
    } catch {
      /* ignore */
    }
  }

  try {
    for (const p of await geocode(trimmed, 4)) {
      results.push({ kind: "place", name: p.name, lat: p.lat, lon: p.lon });
    }
  } catch {
    /* ignore */
  }

  if (!addressLike && results.length < 6) {
    try {
      for (const a of await nominatim(trimmed, 3)) {
        results.push({ kind: "address", name: a.name, lat: a.lat, lon: a.lon });
      }
    } catch {
      /* ignore */
    }
  }

  return results.slice(0, 10);
}
