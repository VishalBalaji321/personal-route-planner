import type { WeatherHour, WeatherSnapshot } from "./types";
import { berlinParts } from "./efa";

export const COMMUTE_WINDOW_HOURS = 2;

/** Bike blocked when temperature is below this (°C). */
export const MIN_BIKE_TEMP_C = 5;

/** Bike blocked when precipitation probability reaches this (%). */
export const MAX_BIKE_PRECIP_PROB = 40;

/** Bike blocked when any single hour exceeds this amount (mm). */
export const MAX_BIKE_PRECIP_MM = 0.1;

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    precipitation?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    apparent_temperature?: number[];
    precipitation_probability?: number[];
    precipitation?: number[];
    wind_speed_10m?: number[];
  };
}

export async function fetchWeather(lat: number, lon: number): Promise<OpenMeteoResponse> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly:
      "temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m",
    current: "temperature_2m,apparent_temperature,precipitation",
    forecast_days: "1",
    timezone: "Europe/Berlin",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    headers: { "user-agent": "personal-route-planner (personal use)" },
  });
  if (!res.ok) throw new Error(`Open-Meteo returned HTTP ${res.status}`);
  return (await res.json()) as OpenMeteoResponse;
}

/**
 * Compute the weather snapshot + bike verdict for the commute window
 * starting at `now` (inclusive) and covering the next `windowHours` hours.
 */
export function computeWeather(
  data: OpenMeteoResponse,
  now: Date,
  windowHours: number = COMMUTE_WINDOW_HOURS,
): WeatherSnapshot {
  const h = data.hourly ?? {};
  const times = h.time ?? [];
  const temps = h.temperature_2m ?? [];
  const feels = h.apparent_temperature ?? [];
  const probs = h.precipitation_probability ?? [];
  const precips = h.precipitation ?? [];
  const winds = h.wind_speed_10m ?? [];

  const startIdx = indexOfHour(times, now);
  const hours: WeatherHour[] = [];
  for (let i = startIdx; i < Math.min(startIdx + windowHours, times.length); i++) {
    hours.push({
      time: times[i],
      temperature: temps[i] ?? NaN,
      apparentTemperature: feels[i] ?? NaN,
      precipitationProb: probs[i] ?? NaN,
      precipitation: precips[i] ?? NaN,
      windSpeed: winds[i] ?? NaN,
    });
  }

  let precipProbMax = 0;
  let precipMax = 0;
  let tempMin = Infinity;
  let windMax = 0;
  for (const hr of hours) {
    if (!Number.isNaN(hr.precipitationProb)) precipProbMax = Math.max(precipProbMax, hr.precipitationProb);
    if (!Number.isNaN(hr.precipitation)) precipMax = Math.max(precipMax, hr.precipitation);
    if (!Number.isNaN(hr.temperature)) tempMin = Math.min(tempMin, hr.temperature);
    if (!Number.isNaN(hr.windSpeed)) windMax = Math.max(windMax, hr.windSpeed);
  }
  if (tempMin === Infinity) tempMin = data.current?.temperature_2m ?? 0;

  const blockedBy: Array<"cold" | "rain"> = [];
  if (tempMin < MIN_BIKE_TEMP_C) blockedBy.push("cold");
  if (precipProbMax >= MAX_BIKE_PRECIP_PROB || precipMax > MAX_BIKE_PRECIP_MM) blockedBy.push("rain");

  return {
    tempNow: data.current?.temperature_2m ?? hours[0]?.temperature ?? NaN,
    apparentTempNow: data.current?.apparent_temperature ?? hours[0]?.apparentTemperature ?? NaN,
    precipNow: data.current?.precipitation ?? 0,
    hours,
    precipProbMax,
    precipMax,
    tempMin,
    windMax,
    bikeAllowed: blockedBy.length === 0,
    blockedBy,
  };
}

/** Index of the hourly bucket containing `now`, or the first hour after it. */
function indexOfHour(times: string[], now: Date): number {
  const p = berlinParts(now);
  const target = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, 0)).getTime();
  for (let i = 0; i < times.length; i++) {
    const t = new Date(`${times[i]}Z`).getTime();
    if (t >= target) return i;
  }
  return 0;
}
