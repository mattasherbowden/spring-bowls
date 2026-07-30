import { describe, expect, it } from "vitest";
import { buildPostGroupPlacements } from "./post-group-schedule";

describe("buildPostGroupPlacements", () => {
  it("shares the semi-final wave with the bowl-off, then reserves a new final wave", () => {
    const placements = buildPostGroupPlacements(
      [
        { id: "final", matchCode: "F1", round: 2 },
        { id: "semi2", matchCode: "SF2", round: 1 },
        { id: "bowl", matchCode: "BOWL1", round: 1 },
        { id: "semi1", matchCode: "SF1", round: 1 },
      ],
      3,
    );

    expect(placements.get("bowl")).toEqual({
      rink: 1,
      order: 1002,
      wave: 0,
    });
    expect(placements.get("semi1")).toEqual({
      rink: 2,
      order: 1003,
      wave: 0,
    });
    expect(placements.get("semi2")).toEqual({
      rink: 3,
      order: 1004,
      wave: 0,
    });
    expect(placements.get("final")).toEqual({
      rink: 1,
      order: 1005,
      wave: 1,
    });
  });

  it("does not pull a final into an unused semi-final rink", () => {
    const placements = buildPostGroupPlacements(
      [
        { id: "semi1", matchCode: "SF1", round: 1 },
        { id: "semi2", matchCode: "SF2", round: 1 },
        { id: "final", matchCode: "F1", round: 2 },
      ],
      3,
    );

    expect(placements.get("semi1")?.wave).toBe(0);
    expect(placements.get("semi2")?.wave).toBe(0);
    expect(placements.get("final")?.wave).toBe(1);
    expect(placements.get("final")?.rink).toBe(1);
  });

  it("uses extra waves when a round has more games than rinks", () => {
    const placements = buildPostGroupPlacements(
      Array.from({ length: 8 }, (_, index) => ({
        id: `qf${index + 1}`,
        matchCode: `QF${index + 1}`,
        round: 1,
      })),
      3,
    );
    expect(Math.max(...[...placements.values()].map((row) => row.wave))).toBe(2);
  });
});
