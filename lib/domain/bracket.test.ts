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

  it("carries bye teams forward so one-sided fixtures can be omitted", () => {
    const rounds = buildBracket(["A1", "B1", "C1", "A2", "B2", "C2"]);
    const playable = rounds.flatMap((round) =>
      round.matches.filter((match) => match.a !== null && match.b !== null),
    );
    expect(playable.every((match) => match.a && match.b)).toBe(true);

    const byeTeams = rounds[0].matches.flatMap((match) =>
      match.a === null ? [match.b] : match.b === null ? [match.a] : [],
    );
    for (const byeTeam of byeTeams) {
      expect(
        rounds[1].matches.some(
          (match) => match.a === byeTeam || match.b === byeTeam,
        ),
      ).toBe(true);
    }
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

  it("has a valid, complete dependency graph for every 2–16-team field", () => {
    for (let teamCount = 2; teamCount <= 16; teamCount++) {
      // Unique group letters make this a pure structural test. Same-group
      // placement is covered separately above.
      const qualifiers = Array.from(
        { length: teamCount },
        (_, i) => `${String.fromCharCode(65 + i)}1`,
      );
      const rounds = buildBracket(qualifiers);
      const allMatches = rounds.flatMap((round) => round.matches);
      const playable = allMatches.filter(
        (match) => match.a !== null && match.b !== null,
      );

      expect(rounds.at(-1)?.matches, `${teamCount} teams: final`).toHaveLength(
        1,
      );
      expect(
        playable,
        `${teamCount} teams: single-elimination game count`,
      ).toHaveLength(teamCount - 1);

      const ids = allMatches.map((match) => match.id);
      expect(
        new Set(ids).size,
        `${teamCount} teams: unique match ids`,
      ).toBe(ids.length);

      const matchPosition = new Map(
        allMatches.map((match, index) => [match.id, index]),
      );
      for (const [index, match] of allMatches.entries()) {
        for (const source of [match.a, match.b]) {
          if (!source?.startsWith("W:")) continue;
          const sourcePosition = matchPosition.get(source.slice(2));
          expect(
            sourcePosition,
            `${teamCount} teams: ${source} exists`,
          ).not.toBeUndefined();
          expect(
            sourcePosition!,
            `${teamCount} teams: ${source} is from an earlier match`,
          ).toBeLessThan(index);
        }
      }

      // This is exactly what resolveKnockout persists after omitting byes:
      // every row has two real sources, and each qualifier enters once.
      const directSources = playable.flatMap((match) => [match.a, match.b]).filter(
        (source): source is string => !!source && !source.startsWith("W:"),
      );
      expect(
        [...directSources].sort(),
        `${teamCount} teams: every qualifier enters once`,
      ).toEqual([...qualifiers].sort());
    }
  });

  it("is structurally valid for all supported group-winner/runner-up fields", () => {
    for (let groupCount = 2; groupCount <= 8; groupCount++) {
      const groups = Array.from(
        { length: groupCount },
        (_, i) => String.fromCharCode(65 + i),
      );
      for (const advance of [1, 2]) {
        const qualifiers = Array.from({ length: advance }, (_, i) => i + 1)
          .flatMap((position) => groups.map((group) => `${group}${position}`));
        const playable = buildBracket(qualifiers)
          .flatMap((round) => round.matches)
          .filter((match) => match.a !== null && match.b !== null);

        expect(playable).toHaveLength(qualifiers.length - 1);
        expect(
          playable.every((match) => match.a !== null && match.b !== null),
        ).toBe(true);
      }
    }
  });
});
