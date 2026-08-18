/** Geocoding helpers: Open-Meteo (places) + Nominatim (street addresses). */

export interface GeocodeResult {
  name: string;
  lat: number;
  lon: number;
  country?: string;
}/** Open-Meteo geocoding — resolves cities, towns and named places. */
export async function geocode(q: string, limit = 6): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    name: q,
    count: String(limit),
    language: "en",
    format: "json",
  });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`, {
    headers: { "user-agent": "personal-route-planner (personal use)" },
  });
  if (!res.ok) throw new Error(`geocoding returned HTTP ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ name?: string; latitude?: number; longitude?: number; country_code?: string }>;
  };
  return (data.results ?? [])
    .filter((r) => r.latitude != null && r.longitude != null && r.name)
    .map((r) => ({
      name: r.name as string,
      lat: r.latitude as number,
      lon: r.longitude as number,
      country: r.country_code,
    }));
}

/**
 * Nominatim (OpenStreetMap) — resolves street addresses and precise places.
 * Free, but usage-policy friendly: low volume + honest UA + ~1 req/s.
 */
export async function nominatim(q: string, limit = 4): Promise<GeocodeResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { "user-agent": "vishal-commute-pro-max (personal commute app)" },
  });
  if (!res.ok) throw new Error(`nominatim returned HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{
    lat?: string;
    lon?: string;
    name?: string;
    display_name?: string;
    address?: { road?: string; house_number?: string; suburb?: string; city?: string; town?: string };
  }>;
  const out: GeocodeResult[] = [];
  for (const r of rows) {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const a = r.address ?? {};
    const short =
      [a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road, a.suburb || a.town || a.city]
        .filter(Boolean)
        .join(", ") ||
      r.name ||
      r.display_name ||
      q;
    out.push({ name: short.slice(0, 90), lat, lon });
  }
  return out;
}

interface ReverseAddress {
  road?: string;
  house_number?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  state?: string;
}

/** Short human label for a Nominatim reverse address. */
export function shortReverseLabel(a: ReverseAddress): string | null {
  const road = a.road || a.house_number;
  const locality = a.suburb || a.town || a.village || a.city || a.municipality;
  const parts = [road, locality].filter(Boolean);
  const out = (parts.length ? parts.join(", ") : a.state || "").trim();
  return out ? out.slice(0, 90) : null;
}

/**
 * Nominatim reverse geocoding — short name for a WGS84 coordinate
 * (e.g. the GPS "current location"). Returns null when nothing usable.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lon}`;
  const res = await fetch(url, {
    headers: { "user-agent": "vishal-commute-pro-max (personal commute app)" },
  });
  if (!res.ok) throw new Error(`nominatim reverse returned HTTP ${res.status}`);
  const data = (await res.json()) as { address?: ReverseAddress; display_name?: string };
  return shortReverseLabel(data.address ?? {}) ?? data.display_name?.slice(0, 90) ?? null;
}
