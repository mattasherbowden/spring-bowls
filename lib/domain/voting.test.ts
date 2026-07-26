import { describe, expect, it } from "vitest";
import { isAwardVotingOpen, isOrganiserNominee } from "./voting";

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

describe("isOrganiserNominee", () => {
  it("blocks both the owner and helper admins from individual awards", () => {
    expect(isOrganiserNominee({ is_owner: true, is_admin: false })).toBe(true);
    expect(isOrganiserNominee({ is_owner: false, is_admin: true })).toBe(true);
  });

  it("keeps ordinary players eligible", () => {
    expect(isOrganiserNominee({ is_owner: false, is_admin: false })).toBe(false);
    expect(isOrganiserNominee(null)).toBe(false);
  });
});
