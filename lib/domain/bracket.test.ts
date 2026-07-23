import { describe, it, expect } from "vitest";
import { buildBracket } from "./bracket";

describe("buildBracket", () => {
  it("returns nothing for fewer than 2 qualifiers", () => {
    expect(buildBracket([])).toEqual([]);
    expect(buildBracket(["A1"])).toEqual([]);
  });

  it("builds a clean bracket for a power-of-two field", () => {
    const b = buildBracket(["A1", "B1", "C1", "D1"]);
    expect(b.map((r) => r.name)).toEqual(["Semi-finals", "Final"]);
    expect(b[0].matches).toHaveLength(2);
    expect(b[1].matches).toHaveLength(1);
    expect(b[1].matches[0]).toMatchObject({ a: "W:SF1", b: "W:SF2" });
  });

  it("adds byes for a non-power-of-two field", () => {
    const b = buildBracket(["A1", "B1", "C1", "D1", "E1", "F1"]); // 6 -> 8
    expect(b[0].name).toBe("Quarter-finals");
    expect(b[0].matches).toHaveLength(4);
    const byes = b[0].matches.filter((m) => m.a === null || m.b === null);
    expect(byes).toHaveLength(2);
    const labels = b[0].matches.flatMap((m) => [m.a, m.b]).filter(Boolean);
    expect(new Set(labels).size).toBe(6);
  });

  it("keeps the two top seeds in different halves", () => {
    const b = buildBracket(["A1", "B1", "C1", "D1"]);
    const semis = b[0].matches;
    const inSemi = (label: string) =>
      semis.findIndex((m) => m.a === label || m.b === label);
    expect(inSemi("A1")).not.toBe(inSemi("B1"));
  });
});
