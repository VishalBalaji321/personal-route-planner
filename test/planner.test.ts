import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEfaTrips, dateFromBerlinWallClock } from "../src/efa";
import { planCommute, placeCoords } from "../src/planner";
import { SEED_PLACES, walkMinutesFor, bikeMinutesFor, fullBikeMinutesFor } from "../src/config";
import type { PlaceSpec, WeatherSnapshot } from "../src/types";

const FIXTURES = join(import.meta.dirname, "fixtures");

const now = dateFromBerlinWallClock({ year: 2026, month: 8, day: 16, hour: 8, minute: 30 });

function tripsFrom(name: string) {
  const raw = JSON.parse(readFileSync(join(FIXTURES, name), "utf-8"));
  return parseEfaTrips(raw.trips ?? []);
}

const homeSpec: PlaceSpec = {
  id: "home",
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
};

const work2Spec: PlaceSpec = {
  id: "work2",
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
};

const work1Spec: PlaceSpec = {
  id: "work1",
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
};

const goodWeather: WeatherSnapshot = {
  tempNow: 20,
  apparentTempNow: 19,
  precipNow: 0,
  hours: [],
  precipProbMax: 0,
  precipMax: 0,
  tempMin: 18,
  windMax: 10,
  bikeAllowed: true,
  blockedBy: [],
};

const badWeather: WeatherSnapshot = { ...goodWeather, bikeAllowed: false, blockedBy: ["rain"] };

describe("planCommute", () => {
  it("returns transit options for home → work2, ranked by arrival", async () => {
    const trips = tripsFrom("efa_trip_moosach_amhart.json");
    const res = await planCommute(homeSpec, work2Spec, now, goodWeather, {
      fetchTrips: async () => trips,
    });
    expect(res.options.some((o) => o.kind === "transit")).toBe(true);
    for (let i = 1; i < res.options.length; i++) {
      expect(res.options[i].arriveAt.getTime()).toBeGreaterThanOrEqual(
        res.options[i - 1].arriveAt.getTime(),
      );
    }
  });

  it("offers a full-bike option only from a home place and when weather allows", async () => {
    const trips = tripsFrom("efa_trip_moosach_amhart.json");
    const ok = await planCommute(homeSpec, work2Spec, now, goodWeather, {
      maxBikeMinutes: 60,
      fetchTrips: async () => trips,
    });
    expect(ok.options.some((o) => o.kind === "bike")).toBe(true);

    const notOk = await planCommute(homeSpec, work2Spec, now, badWeather, {
      maxBikeMinutes: 60,
      fetchTrips: async () => trips,
    });
    expect(notOk.options.some((o) => o.kind === "bike")).toBe(false);

    // Returning home: origin is NOT home → no full-bike option.
    const reverse = await planCommute(work2Spec, homeSpec, now, goodWeather, {
      maxBikeMinutes: 60,
      fetchTrips: async () => trips,
    });
    expect(reverse.options.some((o) => o.kind === "bike")).toBe(false);
  });

  it("adds a bike-to-station option at the home end when weather allows", async () => {
    const trips = tripsFrom("efa_trip_moosach_amhart.json");
    const res = await planCommute(homeSpec, work2Spec, now, goodWeather, {
      fetchTrips: async () => trips,
    });
    const walkTransit = res.options.filter(
      (o) => o.kind === "transit" && o.originAccess.mode === "walk",
    );
    const bikeTransit = res.options.filter(
      (o) => o.kind === "transit" && o.originAccess.mode === "bike",
    );
    expect(bikeTransit.length).toBeGreaterThan(0);
    const earliestWalkLeave = Math.min(...walkTransit.map((o) => o.leaveAt.getTime()));
    expect(bikeTransit.some((o) => o.leaveAt.getTime() > earliestWalkLeave)).toBe(true);
  });

  it("does not offer bike access for the return direction (work → home)", async () => {
    const trips = tripsFrom("efa_trip_amhart_moosach.json");
    const res = await planCommute(work2Spec, homeSpec, now, goodWeather, {
      fetchTrips: async () => trips,
    });
    const transit = res.options.filter((o) => o.kind === "transit");
    expect(transit.length).toBeGreaterThan(0);
    expect(transit.every((o) => o.originAccess.mode === "walk")).toBe(true);
    // But a bike egress home is offered.
    expect(transit.some((o) => o.egress.mode === "bike")).toBe(true);
  });

  it("drops trips you cannot physically catch", async () => {
    const trips = tripsFrom("efa_trip_moosach_amhart.json");
    const later = dateFromBerlinWallClock({ year: 2026, month: 8, day: 16, hour: 8, minute: 59 });
    const res = await planCommute(homeSpec, work2Spec, later, goodWeather, {
      fetchTrips: async () => trips,
    });
    for (const o of res.options) {
      expect(o.leaveAt.getTime()).toBeGreaterThanOrEqual(later.getTime());
    }
  });

  it("drops bike options exceeding the max biking time", async () => {
    const trips = tripsFrom("efa_trip_moosach_amhart.json");
    // Full-bike home→work2 is >20 min; bike-to-station is 6 min.
    const strict = await planCommute(homeSpec, work2Spec, now, goodWeather, {
      maxBikeMinutes: 10,
      fetchTrips: async () => trips,
    });
    expect(strict.options.some((o) => o.kind === "bike")).toBe(false);
    const relaxed = await planCommute(homeSpec, work2Spec, now, goodWeather, {
      maxBikeMinutes: 20,
      fetchTrips: async () => trips,
    });
    expect(relaxed.options.some((o) => o.originAccess.mode === "bike")).toBe(true);
    expect(relaxed.options.some((o) => o.kind === "bike")).toBe(false);
  });

  it("tries every candidate access/egress station", async () => {
    const trips = tripsFrom("efa_trip_moosach_amhart.json");
    const calls: string[] = [];
    await planCommute(work1Spec, homeSpec, now, goodWeather, {
      maxBikeMinutes: 60,
      fetchTrips: async (o) => {
        calls.push(`${o.originStationId}->${o.destStationId}`);
        return trips;
      },
    });
    expect(calls).toContain("1002009->91000300");
    expect(calls).toContain("1002012->91000300");
  });

  it("seeds default places without personal data", () => {
    const seeds = SEED_PLACES;
    expect(seeds.length).toBe(3);
    expect(seeds.every((p) => p.address === "")).toBe(true);
    expect(seeds.every((p) => p.lat === undefined && p.lon === undefined)).toBe(true);
    const home = seeds.find((p) => p.isHome);
    expect(home?.stations[0].stopId).toBe("91000300");
  });

  it("forces bike options in bike mode even when weather blocks biking", async () => {
    const trips = tripsFrom("efa_trip_moosach_amhart.json");
    const res = await planCommute(homeSpec, work2Spec, now, badWeather, {
      maxBikeMinutes: 60,
      travelMode: "bike",
      fetchTrips: async () => trips,
    });
    expect(res.options.length).toBeGreaterThan(0);
    // Every option uses the bike at the origin (no walk-access transit).
    for (const o of res.options) {
      if (o.kind === "bike") continue;
      expect(o.kind).toBe("transit");
      expect(o.originAccess.mode).toBe("bike");
    }
    expect(res.options.some((o) => o.kind === "bike")).toBe(true);
  });

  it("hides all bike options in transit mode", async () => {
    const trips = tripsFrom("efa_trip_moosach_amhart.json");
    const res = await planCommute(homeSpec, work2Spec, now, goodWeather, {
      maxBikeMinutes: 60,
      travelMode: "transit",
      fetchTrips: async () => trips,
    });
    expect(res.options.length).toBeGreaterThan(0);
    for (const o of res.options) {
      expect(o.kind).toBe("transit");
      expect(o.originAccess.mode).toBe("walk");
      expect(o.egress.mode).toBe("walk");
    }
  });

  it("offers nothing in bike mode from a non-home origin (HOME rule kept)", async () => {
    const trips = tripsFrom("efa_trip_amhart_moosach.json");
    const res = await planCommute(work2Spec, homeSpec, now, goodWeather, {
      maxBikeMinutes: 60,
      travelMode: "bike",
      fetchTrips: async () => trips,
    });
    expect(res.options.length).toBe(0);
  });

  it("computes access times from distance", () => {
    // ~1 km at 4.8 km/h with 1.3 detour ≈ 16 min
    expect(walkMinutesFor(1000)).toBeGreaterThanOrEqual(15);
    // Bike is faster and includes fetch overhead.
    expect(bikeMinutesFor(1000)).toBeLessThan(walkMinutesFor(1000));
    expect(bikeMinutesFor(0)).toBe(Infinity);
    expect(fullBikeMinutesFor(10)).toBeGreaterThan(50);
  });

  it("falls back to station coords for place coordinates", () => {
    expect(placeCoords(homeSpec)).toEqual({ lat: 48.1808, lon: 11.5076 });
  });
});
