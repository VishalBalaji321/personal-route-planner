export type AccessMode = "walk" | "bike";

export interface WeatherHour {
  /** Berlin wall-clock "YYYY-MM-DDTHH:00" label. */
  time: string;
  /** Temperature 2m in °C. */
  temperature: number;
  /** Apparent temperature in °C. */
  apparentTemperature: number;
  /** Precipitation probability in %. */
  precipitationProb: number;
  /** Precipitation in mm. */
  precipitation: number;
  /** Wind speed 10m in km/h. */
  windSpeed: number;
}

export interface WeatherSnapshot {
  /** Current temperature in °C. */
  tempNow: number;
  /** Current apparent temperature in °C. */
  apparentTempNow: number;
  /** Current precipitation in mm. */
  precipNow: number;
  /** Forecast hours covering the commute window (next 2h). */
  hours: WeatherHour[];
  /** Max precipitation probability over the window. */
  precipProbMax: number;
  /** Max precipitation amount over the window. */
  precipMax: number;
  /** Min temperature over the window. */
  tempMin: number;
  /** Max wind over the window. */
  windMax: number;
  /** True when it is pleasant enough to bike by our rules. */
  bikeAllowed: boolean;
  /** Reasons biking is blocked: "cold" and/or "rain". */
  blockedBy: Array<"cold" | "rain">;
}

/** A single candidate access/egress station for a place. */
export interface StationSpec {
  /** EFA numeric stop id (e.g. "91000300"). */
  stopId: string;
  /** EFA stop label, e.g. "München, Moosach Bf". */
  label: string;
  lat: number;
  lon: number;
  /** Walk minutes from the place to this station. */
  walkMin: number;
  /** Bike minutes from the place to this station (Infinity when not an option). */
  bikeMin: number;
  /** Approximate straight-line distance in meters (used for the >600m rule). */
  distanceMeters: number;
}

/** A user-defined origin or destination. Stored client-side (localStorage). */
export interface PlaceSpec {
  /** Client-generated id. */
  id: string;
  /** Display name, e.g. "Home", "BMW FIZ". */
  name: string;
  /** Raw address/query the user typed (may be empty for saved defaults). */
  address: string;
  /** Coordinates of the place itself (may be undefined → falls back to station coords). */
  lat?: number;
  lon?: number;
  /** Marked as home → enables bike-to-station at origin + full-bike + bike egress. */
  isHome: boolean;
  /** Candidate stations, ordered by preference; planner tries each. */
  stations: StationSpec[];
}

export interface TransitLeg {
  type: "transit";
  /** "U-Bahn", "S-Bahn", "StadtBus", "ExpressBus", "RegionalBus", "Tram". */
  product: string;
  /** "U6", "S1", "292", "X201", … */
  number: string;
  destination: string;
  from: string;
  to: string;
  /** Departure from `from` (realtime where monitored, else scheduled). */
  departAt: Date;
  /** Arrival at `to` (realtime where monitored, else scheduled). */
  arriveAt: Date;
  /** Delay in minutes vs schedule (>0 means late). */
  delayMin: number;
  /** Platform/gleis if known. */
  platform?: string;
  realtimeStatus?: string;
  /** Scheduled in-vehicle+wait minutes (display only). */
  minutes: number;
}

export interface WalkLeg {
  type: "walk";
  from: string;
  to: string;
  minutes: number;
}

export type Leg = TransitLeg | WalkLeg;

export interface CommuteOption {
  kind: "transit" | "bike";
  /** Short human title, e.g. "S1 > X201 > Bus 290". */
  title: string;
  /** Door-to-door minutes (leave origin → arrive destination). */
  totalMin: number;
  /** When to leave the origin place (realtime-aware for transit). */
  leaveAt: Date;
  /** Arrival at destination place (realtime-aware for transit). */
  arriveAt: Date;
  /** Origin end: how the station is reached. */
  originAccess: { mode: AccessMode; minutes: number };
  /** Destination end: how the place is reached from the station. */
  egress: { mode: AccessMode; minutes: number };
  legs: Leg[];
  /** True if any transit leg carries a realtime delay. */
  hasDelay: boolean;
  /** Sum of realtime delays across transit legs (minutes). */
  totalDelayMin: number;
  /** True when the trip's realtime arrival was used. */
  realtimeArrival: boolean;
  /** Raw EFA duration (scheduled), minutes. */
  transitDurationMin?: number;
}

export interface CommuteRequest {
  from: PlaceSpec;
  to: PlaceSpec;
  /** Cap on biking minutes per option (user setting). */
  maxBikeMinutes?: number;
  /** ISO start time; defaults to "now". */
  start?: string;
}

export interface CommuteResponse {
  generatedAt: string;
  /** The departure instant options were computed for (ISO); may differ from generatedAt when a start time is set. */
  queryFor: string;
  /** ISO start time the user requested, or null when "leave now". */
  startTime: string | null;
  /** Cap on biking minutes per option (user setting). */
  maxBikeMinutes: number;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  weather: WeatherSnapshot;
  options: CommuteOption[];
  errors: string[];
}
