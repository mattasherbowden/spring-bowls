import { describe, it, expect } from "vitest";
import { isOpenStatus, upNextInfo, type RinkFixture } from "./up-next";

function fx(over: Partial<RinkFixture> & { id: string }): RinkFixture {
  return {
    rink: 2,
    order_index: 0,
    team_a_id: "a",
    team_b_id: "b",
    status: "pending",
    ...over,
  };
}

// Your game: rink 2, tenth on the board.
const me = {
  id: "me",
  rink: 2,
  order_index: 10,
  team_a_id: "mine",
  team_b_id: "opponent",
};

describe("isOpenStatus", () => {
  it("treats completed and walkover as no longer to-be-played", () => {
    expect(isOpenStatus("completed")).toBe(false);
    expect(isOpenStatus("walkover")).toBe(false);
  });
  it("treats anything else as still to be played", () => {
    expect(isOpenStatus("pending")).toBe(true);
    expect(isOpenStatus("scheduled")).toBe(true);
    expect(isOpenStatus("open")).toBe(true);
  });
});

describe("upNextInfo", () => {
  it("is 'tbd' when the opponent is not decided — even with a game ahead", () => {
    const info = upNextInfo(
      me,
      [fx({ id: "x", rink: 2, order_index: 5, status: "pending" })],
      false,
    );
    expect(info.status).toBe("tbd");
  });

  it("is 'live' when your rink is clear (no open game ahead of you)", () => {
    const info = upNextInfo(
      me,
      [
        fx({ id: "done", rink: 2, order_index: 5, status: "completed" }),
        fx({ id: "otherRink", rink: 3, order_index: 5, status: "pending" }),
        fx({ id: "afterYou", rink: 2, order_index: 15, status: "pending" }),
      ],
      true,
    );
    expect(info.status).toBe("live");
    expect(info.aheadGame).toBeNull();
    expect(info.aheadCount).toBe(0);
    expect(info.blocker).toBeNull();
  });

  it("is 'waiting' when an open game is ahead of you on your rink", () => {
    const info = upNextInfo(
      me,
      [
        fx({ id: "early", rink: 2, order_index: 3, status: "pending" }),
        fx({ id: "nearest", rink: 2, order_index: 7, status: "scheduled" }),
      ],
      true,
    );
    expect(info.status).toBe("waiting");
    expect(info.aheadCount).toBe(2);
    expect(info.blocker).toBe("rink");
    // aheadGame is the nearest one (highest order_index below yours).
    expect(info.aheadGame?.id).toBe("nearest");
  });

  it("waits when either team is still playing an earlier game on another rink", () => {
    const info = upNextInfo(
      me,
      [
        fx({
          id: "opponent-playing",
          rink: 4,
          order_index: 8,
          team_a_id: "someone",
          team_b_id: "opponent",
          status: "scheduled",
        }),
      ],
      true,
    );
    expect(info.status).toBe("waiting");
    expect(info.blocker).toBe("team");
    expect(info.aheadGame?.id).toBe("opponent-playing");
    expect(info.aheadCount).toBe(0);
  });

  it("ignores an unrelated open game on another rink", () => {
    const info = upNextInfo(
      me,
      [
        fx({
          id: "unrelated",
          rink: 4,
          order_index: 8,
          team_a_id: "other-a",
          team_b_id: "other-b",
          status: "scheduled",
        }),
      ],
      true,
    );
    expect(info.status).toBe("live");
    expect(info.blocker).toBeNull();
  });

  it("ignores a completed earlier game involving one of the teams", () => {
    const info = upNextInfo(
      me,
      [
        fx({
          id: "opponent-done",
          rink: 4,
          order_index: 8,
          team_a_id: "someone",
          team_b_id: "opponent",
          status: "completed",
        }),
      ],
      true,
    );
    expect(info.status).toBe("live");
    expect(info.blocker).toBeNull();
  });

  it("is 'unknown' when ready but no rink is assigned yet", () => {
    const info = upNextInfo(
      { id: "me", rink: null, order_index: 10 },
      [fx({ id: "x", rink: 2, order_index: 5, status: "pending" })],
      true,
    );
    expect(info.status).toBe("unknown");
    expect(info.aheadGame).toBeNull();
    expect(info.aheadCount).toBe(0);
    expect(info.blocker).toBeNull();
  });

  it("does not count finished games ahead (completed or walkover)", () => {
    const info = upNextInfo(
      me,
      [
        fx({ id: "c", rink: 2, order_index: 4, status: "completed" }),
        fx({ id: "w", rink: 2, order_index: 6, status: "walkover" }),
      ],
      true,
    );
    expect(info.status).toBe("live");
    expect(info.aheadCount).toBe(0);
  });

  it("ignores your own fixture, later games, and other rinks", () => {
    const info = upNextInfo(
      me,
      [
        fx({ id: "me", rink: 2, order_index: 10, status: "pending" }), // self
        fx({ id: "same", rink: 2, order_index: 10, status: "pending" }), // equal order
        fx({ id: "later", rink: 2, order_index: 12, status: "pending" }), // after you
        fx({ id: "elsewhere", rink: 5, order_index: 2, status: "pending" }), // other rink
      ],
      true,
    );
    expect(info.status).toBe("live");
    expect(info.aheadCount).toBe(0);
  });

  it("counts every open game ahead and picks the nearest", () => {
    const info = upNextInfo(
      me,
      [
        fx({ id: "g1", rink: 2, order_index: 1, status: "pending" }),
        fx({ id: "g4", rink: 2, order_index: 4, status: "pending" }),
        fx({ id: "g8", rink: 2, order_index: 8, status: "pending" }),
      ],
      true,
    );
    expect(info.aheadCount).toBe(3);
    expect(info.aheadGame?.id).toBe("g8");
  });
});
