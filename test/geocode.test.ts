import { describe, it, expect } from "vitest";
import { shortReverseLabel } from "../src/geocode";

describe("shortReverseLabel", () => {
  it("joins road and locality", () => {
    expect(shortReverseLabel({ road: "Leopoldstraße", city: "München" })).toBe(
      "Leopoldstraße, München",
    );
  });

  it("prefers suburb over city", () => {
    expect(shortReverseLabel({ road: "Voithstraße", suburb: "Hochbrück", city: "Garching" })).toBe(
      "Voithstraße, Hochbrück",
    );
  });

  it("handles house number without a road name", () => {
    expect(shortReverseLabel({ house_number: "5", town: "Unterschleißheim" })).toBe(
      "5, Unterschleißheim",
    );
  });

  it("returns null for an empty address", () => {
    expect(shortReverseLabel({})).toBeNull();
  });

  it("caps at 90 chars", () => {
    const long = "Straße".repeat(30);
    expect(shortReverseLabel({ road: long })?.length).toBe(90);
  });
});
