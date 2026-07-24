import { describe, it, expect } from "vitest";
import { assignPhotoPartners } from "./photo";

function makePlayers(teams: number, perTeam: number) {
  const players: { id: string; teamId: string }[] = [];
  for (let t = 0; t < teams; t++)
    for (let p = 0; p < perTeam; p++)
      players.push({ id: `t${t}p${p}`, teamId: `t${t}` });
  return players;
}

describe("assignPhotoPartners", () => {
  it("gives everyone a partner: never yourself, never a team-mate", () => {
    for (let run = 0; run < 25; run++) {
      const players = makePlayers(12, 2); // 24 players, teams of 2
      const teamOf = new Map(players.map((p) => [p.id, p.teamId]));
      const map = assignPhotoPartners(players);
      expect(map.size).toBe(players.length);
      for (const [id, partner] of map) {
        expect(partner).not.toBe(id);
        expect(teamOf.get(partner)).not.toBe(teamOf.get(id));
      }
    }
  });

  it("makes mutual pairs for an even field", () => {
    for (let run = 0; run < 25; run++) {
      const map = assignPhotoPartners(makePlayers(12, 2));
      for (const [id, partner] of map) {
        expect(map.get(partner)).toBe(id);
      }
    }
  });

  it("still covers everyone with an odd field", () => {
    const players = [...makePlayers(2, 2), { id: "solo", teamId: "tX" }]; // 5
    const teamOf = new Map(players.map((p) => [p.id, p.teamId]));
    const map = assignPhotoPartners(players);
    expect(map.size).toBe(players.length);
    for (const [id, partner] of map) {
      expect(partner).not.toBe(id);
      expect(teamOf.get(partner)).not.toBe(teamOf.get(id));
    }
  });
});
