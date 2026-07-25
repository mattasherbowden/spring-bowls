import { describe, expect, it } from "vitest";
import { validateScoreEntry } from "./score-entry";

describe("validateScoreEntry", () => {
  it("accepts the configured regular ends and assigns trusted flags", () => {
    expect(
      validateScoreEntry(
        [
          { shotsA: 7, shotsB: 3, isDecider: true },
          { shotsA: 2, shotsB: 4, isDecider: true },
        ],
        2,
      ),
    ).toEqual({
      ends: [
        { shotsA: 7, shotsB: 3, isDecider: false },
        { shotsA: 2, shotsB: 4, isDecider: false },
      ],
    });
  });

  it("accepts one or more deciders only while the running total is level", () => {
    expect(
      validateScoreEntry(
        [
          { shotsA: 2, shotsB: 1 },
          { shotsA: 0, shotsB: 1 },
          { shotsA: 0, shotsB: 0 },
          { shotsA: 1, shotsB: 0 },
        ],
        2,
      ),
    ).toEqual({
      ends: [
        { shotsA: 2, shotsB: 1, isDecider: false },
        { shotsA: 0, shotsB: 1, isDecider: false },
        { shotsA: 0, shotsB: 0, isDecider: true },
        { shotsA: 1, shotsB: 0, isDecider: true },
      ],
    });
  });

  it("rejects a decider added to a game that was already decided", () => {
    expect(
      validateScoreEntry(
        [
          { shotsA: 3, shotsB: 1 },
          { shotsA: 0, shotsB: 0 },
          { shotsA: 0, shotsB: 2 },
        ],
        2,
      ),
    ).toMatchObject({ error: expect.stringMatching(/only.*level/i) });
  });

  it.each([
    [[{ shotsA: 1, shotsB: 0 }], "all 2 regular"],
    [
      [
        { shotsA: -1, shotsB: 0 },
        { shotsA: 0, shotsB: 0 },
      ],
      "whole number",
    ],
    [
      [
        { shotsA: 1.5, shotsB: 0 },
        { shotsA: 0, shotsB: 0 },
      ],
      "whole number",
    ],
    [
      [
        { shotsA: 1000, shotsB: 0 },
        { shotsA: 0, shotsB: 0 },
      ],
      "whole number",
    ],
    ["not-an-array", "all 2 regular"],
  ])("rejects malformed input %#", (value, message) => {
    expect(validateScoreEntry(value, 2)).toMatchObject({
      error: expect.stringContaining(message),
    });
  });
});
