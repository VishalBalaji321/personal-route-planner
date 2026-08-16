import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEfaTrips, parseStopfinderCandidates } from "../src/efa";
import type { TransitLeg } from "../src/types";

const FIXTURES = join(import.meta.dirname, "fixtures");

function loadFixture(name: string) {
  const raw = JSON.parse(readFileSync(join(FIXTURES, name), "utf-8"));
  return parseEfaTrips(raw.trips ?? []);
}

function loadJson(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf-8"));
}

describe("EFA stopfinder parsing", () => {
  it("parses a multi-match list (index-object shape)", () => {
    const cands = parseStopfinderCandidates(loadJson("stopfinder_marienplatz.json"));
    expect(cands.some((c) => c.stopId === "91000002" && c.name.includes("München"))).toBe(true);
    // List matches omit coordinates.
    expect(cands[0].lat).toBeUndefined();
  });

  it("parses a single unique match with coordinates", () => {
    const cands = parseStopfinderCandidates(loadJson("stopfinder_moosach.json"));
    const moosach = cands.find((c) => c.stopId === "91000300");
    expect(moosach).toBeDefined();
    expect(moosach!.lat).toBeCloseTo(48.1808, 2);
    expect(moosach!.lon).toBeCloseTo(11.5076, 2);
  });
});

describe("EFA trip parsing", () => {
  it("parses Moosach → Am Hart into realtime-aware trips", () => {
    const trips = loadFixture("efa_trip_moosach_amhart.json");
    expect(trips.length).toBeGreaterThan(0);

    const t = trips[0];
    expect(t.durationMin).toBeGreaterThan(0);
    expect(t.realtimeArrival.getTime()).toBeGreaterThan(t.realtimeDeparture.getTime());

    const transit = t.legs.filter((l) => l.type === "transit");
    expect(transit.length).toBeGreaterThan(0);
    // First leg departs at the origin station.
    expect(transit[0].from).toContain("Moosach");
  });

  it("captures the realtime departure delay on the S1 leg", () => {
    const trips = loadFixture("efa_trip_moosach_amhart.json");
    const t = trips[0];
    const s1 = t.legs.find((l): l is TransitLeg => l.type === "transit" && l.number === "S1");
    expect(s1).toBeDefined();
    expect(s1!.delayMin).toBe(1); // sched 08:56, realtime 08:57 in fixture
  });

  it("parses transfers encoded as Fussweg legs", () => {
    const trips = loadFixture("efa_trip_moosach_jahnstrasse.json");
    const t = trips[0];
    expect(t.durationMin).toBe(40);
    const products = t.legs.filter((l) => l.type === "transit").map((l) => l.product);
    expect(products).toContain("S-Bahn");
  });

  it("includes transfer walking segments from footpath arrays", () => {
    const trips = loadFixture("efa_trip_moosach_amhart.json");
    const t = trips[0];
    const walks = t.legs.filter((l) => l.type === "walk");
    expect(walks.length).toBeGreaterThan(0);
    for (const w of walks) {
      expect(w.minutes).toBeGreaterThan(0);
    }
  });
});
