import { describe, expect, it } from "vitest";
import {
  isAwardVotingOpen,
  isOwnerExcludedFromAward,
} from "./voting";

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
