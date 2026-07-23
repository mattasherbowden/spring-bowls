import { describe, it, expect } from "vitest";
import { suggestUsername, generatePassword } from "./credentials";

describe("suggestUsername", () => {
  it("takes the first name, lowercased and trimmed", () => {
    expect(suggestUsername("Will")).toBe("will");
    expect(suggestUsername("Lucy Smith")).toBe("lucy");
    expect(suggestUsername("  Bo  ")).toBe("bo");
  });

  it("strips characters outside the allowed username set", () => {
    expect(suggestUsername("O'Brien")).toBe("obrien");
    expect(suggestUsername("José")).toBe("jos");
  });

  it("always returns a usable (2+ char) base", () => {
    expect(suggestUsername("A").length).toBeGreaterThanOrEqual(2);
    expect(suggestUsername("").length).toBeGreaterThanOrEqual(2);
    expect(suggestUsername("!!")).toBe(FALLBACK_START);
  });
});

const FALLBACK_START = "player";

describe("generatePassword", () => {
  it("is a lowercase word plus 3 digits, at least 6 chars", () => {
    const pw = generatePassword(() => 0.5);
    expect(pw).toMatch(/^[a-z]+\d{3}$/);
    expect(pw.length).toBeGreaterThanOrEqual(6);
  });

  it("varies with the RNG", () => {
    expect(generatePassword(() => 0.01)).not.toBe(generatePassword(() => 0.99));
  });
});
