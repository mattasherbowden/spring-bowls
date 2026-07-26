import { describe, expect, it } from "vitest";
import {
  buildPlayerVotingLabels,
  isAwardVotingOpen,
  isOwnerExcludedFromAward,
} from "./voting";

describe("buildPlayerVotingLabels", () => {
  it("uses first name and surname initial for compact voting labels", () => {
    const labels = buildPlayerVotingLabels([
      { id: "ben", displayName: "Ben Cochrane" },
      { id: "amy", displayName: "  Amy   Smith  " },
      { id: "matt", displayName: "Matt" },
    ]);
    expect(labels.get("ben")).toBe("Ben C.");
    expect(labels.get("amy")).toBe("Amy S.");
    expect(labels.get("matt")).toBe("Matt");
  });

  it("uses full names when surname initials still collide", () => {
    const labels = buildPlayerVotingLabels([
      { id: "one", displayName: "Ben Cochrane" },
      { id: "two", displayName: "Ben Carter" },
    ]);
    expect(labels.get("one")).toBe("Ben Cochrane");
    expect(labels.get("two")).toBe("Ben Carter");
  });

  it("uses team context when two entered names are identical", () => {
    const labels = buildPlayerVotingLabels([
      { id: "one", displayName: "Ben", teamLabel: "Ben & Jess" },
      { id: "two", displayName: "Ben", teamLabel: "Ben & Nick" },
    ]);
    expect(labels.get("one")).toBe("Ben — Ben & Jess");
    expect(labels.get("two")).toBe("Ben — Ben & Nick");
  });
});

describe("isAwardVotingOpen", () => {
  it("keeps Bowl of the Day open before ceremony voting starts", () => {
    expect(isAwardVotingOpen("pending", "bowl_of_the_day", "live")).toBe(true);
    expect(isAwardVotingOpen("pending", "best_dressed", "live")).toBe(false);
    expect(isAwardVotingOpen("pending", "bowl_of_the_day", "setup")).toBe(false);
  });

  it("opens every award together for ceremony voting", () => {
    expect(isAwardVotingOpen("open", "bowl_of_the_day", "live")).toBe(true);
    expect(isAwardVotingOpen("open", "best_dressed", "live")).toBe(true);
  });

  it("closes every award when winners are revealed", () => {
    expect(isAwardVotingOpen("closed", "bowl_of_the_day", "live")).toBe(false);
    expect(isAwardVotingOpen("closed", "best_dressed", "live")).toBe(false);
  });
});

describe("isOwnerExcludedFromAward", () => {
  it("excludes the owner from Coolest Kiwi", () => {
    expect(
      isOwnerExcludedFromAward(
        { is_owner: true, is_admin: false },
        "coolest_kiwi",
      ),
    ).toBe(true);
  });

  it("keeps the owner eligible for Bowl of the Day", () => {
    expect(
      isOwnerExcludedFromAward(
        { is_owner: true, is_admin: false },
        "bowl_of_the_day",
      ),
    ).toBe(false);
  });

  it("keeps helpers and ordinary players eligible for Coolest Kiwi", () => {
    expect(
      isOwnerExcludedFromAward(
        { is_owner: false, is_admin: true },
        "coolest_kiwi",
      ),
    ).toBe(false);
    expect(
      isOwnerExcludedFromAward(
        { is_owner: false, is_admin: false },
        "coolest_kiwi",
      ),
    ).toBe(false);
    expect(isOwnerExcludedFromAward(null, "coolest_kiwi")).toBe(false);
  });
});
