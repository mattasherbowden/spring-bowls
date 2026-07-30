import { describe, expect, it } from "vitest";
import {
  BONUS_BOWL_OFF_CODE,
  bonusBowlOff,
  isBonusBowlOff,
  postGroupMatchLabel,
} from "./consolation";

describe("bonusBowlOff", () => {
  it("adds a third-game bowl-off to the 4+4+4+3, top-one format", () => {
    expect(
      bonusBowlOff(
        [
          { label: "A", size: 4 },
          { label: "B", size: 4 },
          { label: "C", size: 4 },
          { label: "D", size: 3 },
        ],
        1,
      ),
    ).toEqual({
      matchCode: BONUS_BOWL_OFF_CODE,
      round: 1,
      teamASource: "D2",
      teamBSource: "D3",
      groupLabel: "D",
    });
  });

  it("does not silently change other tournament formats", () => {
    expect(
      bonusBowlOff(
        [
          { label: "A", size: 5 },
          { label: "B", size: 5 },
          { label: "C", size: 5 },
        ],
        1,
      ),
    ).toBeNull();
    expect(
      bonusBowlOff(
        [
          { label: "A", size: 4 },
          { label: "B", size: 4 },
          { label: "C", size: 4 },
          { label: "D", size: 3 },
        ],
        2,
      ),
    ).toBeNull();
  });
});

describe("isBonusBowlOff", () => {
  it("recognises only the dedicated bowl-off match", () => {
    expect(isBonusBowlOff(BONUS_BOWL_OFF_CODE)).toBe(true);
    expect(isBonusBowlOff("SF1")).toBe(false);
    expect(isBonusBowlOff(null)).toBe(false);
  });
});

describe("postGroupMatchLabel", () => {
  it("gives player-facing names to every finals fixture", () => {
    expect(postGroupMatchLabel(BONUS_BOWL_OFF_CODE)).toBe("Bonus bowl-off");
    expect(postGroupMatchLabel("QF2")).toBe("Quarter-final");
    expect(postGroupMatchLabel("SF1")).toBe("Semi-final");
    expect(postGroupMatchLabel("F1")).toBe("Final");
    expect(postGroupMatchLabel("R16")).toBe("Knockout");
    expect(postGroupMatchLabel(null)).toBe("Knockout");
  });
});
