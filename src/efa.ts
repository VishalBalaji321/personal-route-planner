import type { TransitLeg, WalkLeg, Leg } from "./types";

/** Berlin wall-clock parts of a Date instant. */
export interface BerlinParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const BERLIN_TZ = "Europe/Berlin";

/** Convert a Date instant to Berlin wall-clock parts. */
export function berlinParts(date: Date): BerlinParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BERLIN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0; // Intl can yield "24" for midnight in some engines
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
  };
}

/**
 * Build a real Date instant from Berlin wall-clock parts.
 * We first interpret the wall-clock as if it were UTC, then subtract the
 * Berlin UTC offset at that time, so the resulting instant renders back to
 * the requested Berlin wall-clock. This makes EFA wall-clock times directly
 * comparable with real instants (`new Date()`).
 */
export function dateFromBerlinWallClock(p: BerlinParts): Date {
  const naive = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute));
  const offset = berlinOffsetMinutes(naive);
  return new Date(naive.getTime() - offset * 60_000);
}

/** Berlin UTC offset (minutes) for the instant whose UTC wall-clock is `naive`. */
function berlinOffsetMinutes(naive: Date): number {
  const parts = berlinParts(naive);
  const naiveMin = naive.getUTCHours() * 60 + naive.getUTCMinutes();
  let diff = parts.hour * 60 + parts.minute - naiveMin;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}

export function formatDateParam(date: Date): string {
  const p = berlinParts(date);
  return `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`;
}

export function formatTimeParam(date: Date): string {
  const p = berlinParts(date);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// EFA JSON shapes (only the parts we consume)
// ---------------------------------------------------------------------------

interface EfaPoint {
  name?: string;
  nameWO?: string;
  place?: string;
  usage?: string;
  platformName?: string;
  dateTime?: {
    date?: string; // "16.08.2026"
    time?: string; // "08:56"
    rtDate?: string;
    rtTime?: string;
  };
}

interface EfaLegRaw {
  mode?: {
    product?: string;
    number?: string;
    destination?: string;
    realtime?: string;
  };
  points?: EfaPoint[];
  timeMinute?: string;
  realtimeStatus?: string;
  footpath?: Array<{ position?: string; duration?: string }>;
}

interface EfaTripRaw {
  duration?: string; // "00:40"
  interchange?: string;
  legs?: EfaLegRaw[];
}

export interface EfaTrip {
  scheduledDeparture: Date;
  realtimeDeparture: Date;
  scheduledArrival: Date;
  realtimeArrival: Date;
  durationMin: number;
  interchange: number;
  legs: Leg[];
}

function parseEfaDateTime(date?: string, time?: string): Date | undefined {
  if (!date || !time) return undefined;
  // date "16.08.2026", time "08:56"
  const [d, mo, y] = date.split(".").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if (!d || !mo || !y || Number.isNaN(h) || Number.isNaN(mi)) return undefined;
  return dateFromBerlinWallClock({ year: y, month: mo, day: d, hour: h, minute: mi });
}

function minutesBetween(a: Date | undefined, b: Date | undefined): number {
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

function parseLeg(raw: EfaLegRaw): Leg[] {
  const mode = raw.mode ?? {};
  const product = mode.product ?? "";
  const points = raw.points ?? [];
  const from = points[0];
  const to = points[points.length - 1];
  const scheduledDep = parseEfaDateTime(from?.dateTime?.date, from?.dateTime?.time);
  const realtimeDep = parseEfaDateTime(from?.dateTime?.rtDate, from?.dateTime?.rtTime);
  const scheduledArr = parseEfaDateTime(to?.dateTime?.date, to?.dateTime?.time);
  const realtimeArr = parseEfaDateTime(to?.dateTime?.rtDate, to?.dateTime?.rtTime);
  const minutes = Number(raw.timeMinute ?? 0);

  const fromName = from?.nameWO || from?.name || "";
  const toName = to?.nameWO || to?.name || "";

  const legs: Leg[] = [];

  if (product.toLowerCase().includes("fussweg") || !product) {
    if (fromName || toName) {
      legs.push({ type: "walk", from: fromName, to: toName, minutes });
    }
  } else {
    legs.push({
      type: "transit",
      product,
      number: mode.number ?? "",
      destination: mode.destination ?? "",
      from: fromName,
      to: toName,
      departAt: realtimeDep ?? scheduledDep ?? new Date(0),
      arriveAt: realtimeArr ?? scheduledArr ?? new Date(0),
      delayMin: minutesBetween(scheduledDep, realtimeDep),
      platform: from?.platformName,
      realtimeStatus: raw.realtimeStatus,
      minutes,
    });
  }

  // Transfers encoded as `footpath` with position AFTER the leg.
  for (const fp of raw.footpath ?? []) {
    if (fp.position !== "AFTER") continue;
    const dur = Number(fp.duration ?? 0);
    if (dur > 0) {
      legs.push({ type: "walk", from: toName, to: "", minutes: dur });
    }
  }

  return legs;
}
function parseTrip(raw: EfaTripRaw): EfaTrip {
  const legs: Leg[] = [];
  for (const l of raw.legs ?? []) legs.push(...parseLeg(l));

  const transitLegs = legs.filter((l): l is TransitLeg => l.type === "transit");
  const scheduledDeparture = transitLegs[0]?.departAt ?? new Date(0);
  const realtimeDeparture = transitLegs[0]?.departAt ?? scheduledDeparture;
  const last = transitLegs[transitLegs.length - 1];
  const scheduledArrival = last?.arriveAt ?? scheduledDeparture;
  const realtimeArrival = last?.arriveAt ?? scheduledArrival;

  const durationMin = Number(raw.duration?.split(":")[0] ?? 0) * 60 +
    Number(raw.duration?.split(":")[1] ?? 0);

  return {
    scheduledDeparture,
    realtimeDeparture,
    scheduledArrival,
    realtimeArrival,
    durationMin,
    interchange: Number(raw.interchange ?? 0),
    legs,
  };
}

/** Parse raw EFA trip JSON (the `trips` array). Exported for tests. */
export function parseEfaTrips(rawTrips: EfaTripRaw[]): EfaTrip[] {
  return rawTrips.map(parseTrip);
}

export interface EfaFetchOptions {
  originStationId: string;
  destStationId: string;
  /** The earliest departure instant to search from. */
  leaveEarliest: Date;
  /** Number of trips to request. */
  trips?: number;
}

export class EfaError extends Error {}

/**
 * Query the MVV EFA journey planner (realtime).
 * https://efa.mvv-muenchen.de/ng/XML_TRIP_REQUEST2
 */
export async function fetchEfaTrips(opts: EfaFetchOptions): Promise<EfaTrip[]> {
  const params = new URLSearchParams({
    outputFormat: "json",
    coordOutputFormat: "WGS84[DD.ddddd]",
    type_origin: "stop",
    name_origin: opts.originStationId,
    type_destination: "stop",
    name_destination: opts.destStationId,
    itdDate: formatDateParam(opts.leaveEarliest),
    itdTime: formatTimeParam(opts.leaveEarliest),
    useRealtime: "1",
    routeType: "LEASTTIME",
    calcNumberOfTrips: String(opts.trips ?? 4),
  });

  const url = `https://efa.mvv-muenchen.de/ng/XML_TRIP_REQUEST2?${params.toString()}`;

  let text: string;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "personal-route-planner (personal use)",
      },
    });
    if (!res.ok) {
      throw new EfaError(`EFA returned HTTP ${res.status}`);
    }
    text = await res.text();
  } catch (err) {
    if (err instanceof EfaError) throw err;
    throw new EfaError(`EFA request failed: ${(err as Error).message}`);
  }

  let data: { trips?: EfaTripRaw[] };
  try {
    data = JSON.parse(text);
  } catch {
    throw new EfaError("EFA returned invalid JSON");
  }

  const rawTrips = data.trips ?? [];
  const trips = rawTrips.map(parseTrip);

  // EFA may return trips whose first leg departs slightly before the requested
  // window; drop anything that leaves earlier than the requested departure.
  const cutoff = opts.leaveEarliest.getTime() - 60_000;
  return trips.filter((t) => t.realtimeDeparture.getTime() >= cutoff);
}

// ---------------------------------------------------------------------------
// Stop lookup (used to resolve a place name/coordinate to EFA stop IDs)
// ---------------------------------------------------------------------------

export interface StopCandidate {
  stopId: string;
  name: string;
  /** Present only when EFA included coordinates in the result list. */
  lat?: number;
  lon?: number;
}

interface StopfinderResponse {
  stopFinder?: {
    points?: {
      point?: Array<{
        name?: string;
        type?: string;
        ref?: { id?: string; coords?: string };
      }>;
    };
  };
}

/** Flatten EFA `points` into a list of candidate dicts (handles both shapes). */
function pointsToList(
  points: unknown,
): Array<{ name?: string; ref?: { id?: string; coords?: string } }> {
  if (!points) return [];
  if (Array.isArray(points)) return points as Array<{ name?: string; ref?: { id?: string; coords?: string } }>;
  if (typeof points !== "object") return [];
  const obj = points as Record<string, unknown>;
  if (obj.point != null) {
    return (Array.isArray(obj.point) ? obj.point : [obj.point]) as Array<{
      name?: string;
      ref?: { id?: string; coords?: string };
    }>;
  }
  // Multi-match shape: { "0": {...}, "1": {...}, ... }
  return Object.values(obj).filter((v) => v && typeof v === "object") as Array<{
    name?: string;
    ref?: { id?: string; coords?: string };
  }>;
}

/**
 * Search EFA's stop database by (partial) name. Ambiguous names return several
 * candidates; EFA only attaches coordinates to single/unique matches, so call
 * `stopInfo` when you need coordinates for a list result.
 */
export async function searchStops(name: string): Promise<StopCandidate[]> {
  const params = new URLSearchParams({
    outputFormat: "json",
    coordOutputFormat: "WGS84[DD.ddddd]",
    type_sf: "stop",
    name_sf: name,
    anyObjFilter_sf: "0",
  });
  const url = `https://efa.mvv-muenchen.de/ng/XML_STOPFINDER_REQUEST?${params.toString()}`;

  let text: string;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "personal-route-planner (personal use)",
      },
    });
    if (!res.ok) throw new EfaError(`stopfinder returned HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    if (err instanceof EfaError) throw err;
    throw new EfaError(`stopfinder request failed: ${(err as Error).message}`);
  }

  let data: StopfinderResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new EfaError("stopfinder returned invalid JSON");
  }

  return parseStopfinderCandidates(data);
}

/** Parse the `stopFinder` section of a stopfinder response (exported for tests). */
export function parseStopfinderCandidates(data: unknown): StopCandidate[] {
  const sf = (data as StopfinderResponse)?.stopFinder;
  const pts = pointsToList(sf?.points);
  if (pts.length === 0) return [];

  const out: StopCandidate[] = [];
  for (const p of pts) {
    const id = p.ref?.id;
    if (!id) continue;
    const coords = p.ref?.coords;
    let lat: number | undefined;
    let lon: number | undefined;
    if (coords) {
      const [lonRaw, latRaw] = coords.split(",").map(Number);
      if (Number.isFinite(lonRaw) && Number.isFinite(latRaw)) {
        lon = lonRaw;
        lat = latRaw;
      }
    }
    out.push({ stopId: id, name: p.name ?? "", lat, lon });
  }
  return out;
}

export interface StopInfo {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
}

/**
 * Resolve a single EFA stop id to its name + WGS84 coordinates via the
 * departure-monitor endpoint. Used when stopfinder lists omit coordinates.
 */
export async function stopInfo(stopId: string): Promise<StopInfo | null> {
  const params = new URLSearchParams({
    outputFormat: "json",
    coordOutputFormat: "WGS84[DD.ddddd]",
    type_dm: "stop",
    name_dm: stopId,
    mode: "direct",
    limit: "1",
  });
  const url = `https://efa.mvv-muenchen.de/ng/XML_DM_REQUEST?${params.toString()}`;

  let text: string;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "personal-route-planner (personal use)",
      },
    });
    if (!res.ok) throw new EfaError(`DM returned HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    if (err instanceof EfaError) throw err;
    throw new EfaError(`DM request failed: ${(err as Error).message}`);
  }

  let data: { dm?: { points?: unknown } };
  try {
    data = JSON.parse(text);
  } catch {
    throw new EfaError("DM returned invalid JSON");
  }

  const pts = pointsToList(data.dm?.points);
  const p = pts[0];
  if (!p) return null;
  const coords = p.ref?.coords;
  if (!coords) return null;
  const [lon, lat] = coords.split(",").map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { stopId, name: p.name ?? stopId, lat, lon };
}
