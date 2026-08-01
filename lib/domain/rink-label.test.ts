import { describe, expect, it } from "vitest";
import { displayRinkNumber } from "./rink-label";

describe("displayRinkNumber", () => {
  it("maps internal slots onto consecutive venue rink numbers", () => {
    expect(displayRinkNumber(1, 4)).toBe(4);
    expect(displayRinkNumber(2, 4)).toBe(5);
    expect(displayRinkNumber(3, 4)).toBe(6);
  });

  it("keeps existing tournaments unchanged by default", () => {
    expect(displayRinkNumber(1, 1)).toBe(1);
    expect(displayRinkNumber(3, null)).toBe(3);
    expect(displayRinkNumber(2, 0)).toBe(2);
  });

  it("preserves an unassigned rink", () => {
    expect(displayRinkNumber(null, 4)).toBeNull();
    expect(displayRinkNumber(undefined, 4)).toBeNull();
  });
});
