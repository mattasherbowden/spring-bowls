import { describe, expect, it } from "vitest";
import { formatFixtureOpenTime, isPlayOpen } from "./play-state";

describe("isPlayOpen", () => {
  it("only opens play for the explicit open state", () => {
    expect(isPlayOpen("open")).toBe(true);
    expect(isPlayOpen("preview")).toBe(false);
    expect(isPlayOpen(null)).toBe(false);
  });
});

describe("formatFixtureOpenTime", () => {
  it("formats database clock values for the player-facing message", () => {
    expect(formatFixtureOpenTime("13:00")).toBe("1:00pm");
    expect(formatFixtureOpenTime("09:05:00")).toBe("9:05am");
    expect(formatFixtureOpenTime("00:00")).toBe("12:00am");
  });

  it("has a safe fallback for a missing or invalid time", () => {
    expect(formatFixtureOpenTime(null)).toBe(
      "when the organiser starts play",
    );
    expect(formatFixtureOpenTime("tomorrow")).toBe(
      "when the organiser starts play",
    );
  });
});
