import { describe, it, expect } from "vitest";
import { computeWeather, MIN_BIKE_TEMP_C, MAX_BIKE_PRECIP_PROB } from "../src/weather";
import { berlinParts, dateFromBerlinWallClock } from "../src/efa";

function fakeNow(hour: number, minute = 0): Date {
  return dateFromBerlinWallClock({ year: 2026, month: 8, day: 16, hour, minute });
}

function makeWeather(overrides: {
  temps?: number[];
  probs?: number[];
  precips?: number[];
} = {}) {
  const times = ["2026-08-16T08:00", "2026-08-16T09:00", "2026-08-16T10:00"];
  const temps = overrides.temps ?? [20, 20, 20];
  const probs = overrides.probs ?? [0, 0, 0];
  const precips = overrides.precips ?? [0, 0, 0];
  return {
    current: { temperature_2m: 20, apparent_temperature: 19, precipitation: 0 },
    hourly: {
      time: times,
      temperature_2m: temps,
      apparent_temperature: temps.map((t) => t - 1),
      precipitation_probability: probs,
      precipitation: precips,
      wind_speed_10m: [5, 6, 7],
    },
  };
}

describe("computeWeather / bike verdict", () => {
  it("allows biking on a warm dry morning", () => {
    const w = computeWeather(makeWeather(), fakeNow(8));
    expect(w.bikeAllowed).toBe(true);
    expect(w.blockedBy).toEqual([]);
  });

  it("blocks on cold (<5°C)", () => {
    const w = computeWeather(makeWeather({ temps: [3, 4, 6] }), fakeNow(8));
    expect(w.bikeAllowed).toBe(false);
    expect(w.blockedBy).toContain("cold");
    expect(w.tempMin).toBeLessThan(MIN_BIKE_TEMP_C);
  });

  it("blocks on rain probability >= 40%", () => {
    const w = computeWeather(makeWeather({ probs: [50, 40, 30] }), fakeNow(8));
    expect(w.bikeAllowed).toBe(false);
    expect(w.blockedBy).toContain("rain");
    expect(w.precipProbMax).toBe(50);
  });

  it("allows at exactly the rain threshold below 40", () => {
    const w = computeWeather(makeWeather({ probs: [39, 20, 10] }), fakeNow(8));
    expect(w.bikeAllowed).toBe(true);
    expect(w.precipProbMax).toBeLessThan(MAX_BIKE_PRECIP_PROB);
  });

  it("blocks on measurable precipitation even if probability low", () => {
    const w = computeWeather(makeWeather({ probs: [10, 10, 10], precips: [0, 0.4, 0] }), fakeNow(8));
    expect(w.bikeAllowed).toBe(false);
    expect(w.blockedBy).toContain("rain");
  });

  it("only considers the commute window hours", () => {
    const w = computeWeather(
      makeWeather({ temps: [20, 20, -1] }),
      fakeNow(8),
      2,
    );
    expect(w.tempMin).toBe(20); // -1°C hour at 10:00 is outside the 2h window
    expect(w.bikeAllowed).toBe(true);
  });
});

describe("berlin wall-clock helpers", () => {
  it("round-trips a Berlin wall-clock instant", () => {
    const d = dateFromBerlinWallClock({ year: 2026, month: 8, day: 16, hour: 9, minute: 5 });
    const parts = berlinParts(d);
    expect(parts).toMatchObject({ year: 2026, month: 8, day: 16, hour: 9, minute: 5 });
  });
});
