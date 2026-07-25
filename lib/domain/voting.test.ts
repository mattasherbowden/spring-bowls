import { describe, expect, it } from "vitest";
import { isOrganiserNominee } from "./voting";

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
