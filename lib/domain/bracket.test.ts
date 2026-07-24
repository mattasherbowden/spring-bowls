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

  it("never pairs two teams from the same group in the first round", () => {
    const groupOf = (l: string) => l.replace(/\d+$/, "");
    const fields = [
      ["A1", "B1", "C1", "A2", "B2", "C2"], // 3 groups -> 8 w/ 2 byes
      ["A1", "B1", "C1", "D1", "A2", "B2", "C2", "D2"], // 4 groups -> 8 exact
      ["A1", "B1", "A2", "B2"], // 2 groups -> 4
    ];
    for (const quals of fields) {
      const first = buildBracket(quals)[0].matches;
      for (const m of first) {
        if (m.a && m.b) expect(groupOf(m.a)).not.toBe(groupOf(m.b));
      }
    }
  });

  it("keeps a group's two teams apart until the final", () => {
    const b = buildBracket(["A1", "B1", "C1", "A2", "B2", "C2"]);
    // A1 and A2 should only be able to meet by both reaching the final.
    const inHalf = (label: string) => {
      const qf = b[0].matches.findIndex((m) => m.a === label || m.b === label);
      return qf < b[0].matches.length / 2 ? 0 : 1; // top half vs bottom half
    };
    for (const g of ["A", "B", "C"]) {
      expect(inHalf(`${g}1`)).not.toBe(inHalf(`${g}2`));
    }
  });
});
