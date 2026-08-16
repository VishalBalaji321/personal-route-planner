import { Hono } from "hono";
import { DEFAULT_MAX_BIKE_MINUTES } from "./config";
import { nearestStations, type Bindings } from "./stations";
import { searchPlaces } from "./search";
import { stopInfo } from "./efa";
import { planCommute, buildResponse, placeCoords } from "./planner";
import { fetchWeather, computeWeather } from "./weather";
import type { CommuteRequest, PlaceSpec } from "./types";

const app = new Hono();

function asBindings(env: unknown): Bindings {
  return env as Bindings;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Validate a PlaceSpec coming from the client. */
function parsePlace(raw: unknown): PlaceSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id.slice(0, 64) : "";
  const name = typeof p.name === "string" ? p.name.slice(0, 120) : "";
  if (!id || !name) return null;

  const stationsRaw = Array.isArray(p.stations) ? p.stations.slice(0, 3) : [];
  if (stationsRaw.length === 0) return null;

  const stations = [];
  for (const s of stationsRaw) {
    const r = s as Record<string, unknown>;
    const stopId = typeof r.stopId === "string" && /^\d+$/.test(r.stopId) ? r.stopId : "";
    const label = typeof r.label === "string" ? r.label.slice(0, 120) : "";
    if (!stopId) return null;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!isFiniteNum(lat) || !isFiniteNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return null;
    }
    const walkMin = Number(r.walkMin);
    if (!isFiniteNum(walkMin) || walkMin < 0 || walkMin > 180) return null;
    // Infinity cannot be serialized to JSON → null means "not bikeable".
    const bikeRaw = r.bikeMin;
    const bikeMin = bikeRaw == null ? Infinity : Number(bikeRaw);
    if (!isFiniteNum(bikeMin) && bikeMin !== Infinity) return null;
    if (bikeMin < 0) return null;
    const distanceMeters = Number(r.distanceMeters);
    stations.push({
      stopId,
      label,
      lat,
      lon,
      walkMin: Math.round(walkMin),
      bikeMin: bikeMin === Infinity ? Infinity : Math.round(bikeMin),
      distanceMeters: isFiniteNum(distanceMeters) ? Math.round(distanceMeters) : 0,
    });
  }
  if (stations.length === 0) return null;

  return {
    id,
    name,
    address: typeof p.address === "string" ? p.address.slice(0, 240) : "",
    lat: isFiniteNum(p.lat) ? Number(p.lat) : undefined,
    lon: isFiniteNum(p.lon) ? Number(p.lon) : undefined,
    isHome: p.isHome === true,
    stations,
  };
}

app.get("/api/health", (c) => c.json({ ok: true }));

/** Free-text search: stations (EFA), places (Open-Meteo), addresses (Nominatim). */
app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  if (!q) return c.json({ error: "Missing 'q'" }, 400);
  try {
    const results = await searchPlaces(q);
    return c.json({ results });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

/** Resolve a single EFA stop id to name + coordinates. */
app.get("/api/station", async (c) => {
  const stopId = (c.req.query("stopId") ?? "").trim();
  if (!/^\d+$/.test(stopId)) return c.json({ error: "Missing or invalid 'stopId'" }, 400);
  try {
    const info = await stopInfo(stopId);
    if (!info) return c.json({ error: "stop not found" }, 404);
    return c.json({ station: info });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

/** Nearest EFA stations to a coordinate (for setting up a new place). */
app.get("/api/stations", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  if (!isFiniteNum(lat) || !isFiniteNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return c.json({ error: "Missing or invalid lat/lon" }, 400);
  }
  try {
    const stations = await nearestStations(lat, lon, asBindings(c.env));
    return c.json({ stations });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

/** Compute the best commute options between two resolved places. */
app.post("/api/commute", async (c) => {
  const serverNow = new Date();
  let body: CommuteRequest;
  try {
    body = (await c.req.json()) as CommuteRequest;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const from = parsePlace(body?.from);
  const to = parsePlace(body?.to);
  if (!from || !to) {
    return c.json({ error: "Missing or invalid 'from'/'to' place spec" }, 400);
  }
  if (from.id === to.id) {
    return c.json({ error: "'from' and 'to' must differ" }, 400);
  }

  const startQ = body?.start;
  let start = serverNow;
  let startTime: string | null = null;
  if (typeof startQ === "string") {
    const t = new Date(startQ);
    if (!Number.isNaN(t.getTime())) {
      start = t > serverNow ? t : serverNow;
      startTime = start.toISOString();
    }
  }

  const maxBikeRaw = Number(body?.maxBikeMinutes);
  const maxBikeMinutes =
    isFiniteNum(maxBikeRaw) && maxBikeRaw >= 1 && maxBikeRaw <= 240
      ? Math.round(maxBikeRaw)
      : DEFAULT_MAX_BIKE_MINUTES;

  const errors: string[] = [];
  const coords = placeCoords(from) ?? { lat: 48.1374, lon: 11.5755 }; // Munich center fallback
  let weather;
  try {
    const w = await fetchWeather(coords.lat, coords.lon);
    weather = computeWeather(w, start);
  } catch (err) {
    errors.push(`weather: ${(err as Error).message}`);
    weather = computeWeather({ current: {}, hourly: {} }, start);
    weather.bikeAllowed = false;
  }

  const { options, errors: planErrors } = await planCommute(from, to, start, weather, {
    maxBikeMinutes,
  });
  errors.push(...planErrors);

  return c.json(
    buildResponse(from, to, serverNow, start, startTime, maxBikeMinutes, weather, options, errors),
  );
});

export default app;
