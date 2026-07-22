import { describe, it, expect } from "vitest";
import { fixtureResult } from "./fixture";
import type { Fixture } from "./types";

describe("fixtureResult", () => {
  it("FR-F1: sums the ends and the higher total wins", () => {
    const f: Fixture = {
      id: "f1",
      teamA: "A",
      teamB: "B",
      outcome: {
        kind: "played",
        ends: [
          { shotsA: 3, shotsB: 1 },
          { shotsA: 2, shotsB: 2 },
        ],
      },
    };
    const r = fixtureResult(f);
    expect(r.shotsA).toBe(5);
    expect(r.shotsB).toBe(3);
    expect(r.winner).toBe("A");
    expect(r.loser).toBe("B");
  });

  it("FR-F2: throws on a level game — draws are not allowed", () => {
    const f: Fixture = {
      id: "f2",
      teamA: "A",
      teamB: "B",
      outcome: {
        kind: "played",
        ends: [
          { shotsA: 2, shotsB: 3 },
          { shotsA: 3, shotsB: 2 },
        ],
      },
    };
    // 5-5: must force a decider, never resolve as a draw.
    expect(() => fixtureResult(f)).toThrowError(/decider/i);
  });

  it("throws when the fixture has no outcome yet", () => {
    const f: Fixture = { id: "f3", teamA: "A", teamB: "B" };
    expect(() => fixtureResult(f)).toThrowError(/no outcome/i);
  });

  it("D-0005: a walkover awards the winner its shots and the loser zero", () => {
    const a = fixtureResult({
      id: "w1",
      teamA: "A",
      teamB: "B",
      outcome: { kind: "walkover", winner: "A", shots: 10 },
    });
    expect(a).toMatchObject({ winner: "A", loser: "B", shotsA: 10, shotsB: 0 });

    const b = fixtureResult({
      id: "w2",
      teamA: "A",
      teamB: "B",
      outcome: { kind: "walkover", winner: "B", shots: 10 },
    });
    expect(b).toMatchObject({ winner: "B", loser: "A", shotsA: 0, shotsB: 10 });
  });
});
