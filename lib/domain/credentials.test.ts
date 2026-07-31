import { describe, it, expect } from "vitest";
import {
  generatePassword,
  suggestUsername,
  themedPasswordCandidates,
} from "./credentials";

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

describe("themedPasswordCandidates", () => {
  it("returns a complete, unique pool for each nationality", () => {
    for (const nationality of ["brit", "kiwi"] as const) {
      const candidates = themedPasswordCandidates(nationality, () => 0);
      expect(candidates.length).toBeGreaterThanOrEqual(20);
      expect(new Set(candidates).size).toBe(candidates.length);
      expect(candidates.every((password) => /^[a-z]+\d+$/.test(password))).toBe(
        true,
      );
    }
  });

  it("keeps the British and Kiwi pools separate", () => {
    const brits = new Set(themedPasswordCandidates("brit", () => 0));
    const kiwis = themedPasswordCandidates("kiwi", () => 0);
    expect(kiwis.some((password) => brits.has(password))).toBe(false);
  });

  it("uses the RNG only to rotate the pool without losing candidates", () => {
    const first = themedPasswordCandidates("kiwi", () => 0);
    const rotated = themedPasswordCandidates("kiwi", () => 0.5);
    expect(rotated[0]).not.toBe(first[0]);
    expect(new Set(rotated)).toEqual(new Set(first));
  });

  it("handles an RNG value of exactly one defensively", () => {
    const candidates = themedPasswordCandidates("brit", () => 1);
    expect(candidates).toHaveLength(
      themedPasswordCandidates("brit", () => 0).length,
    );
    expect(candidates[0]).toMatch(/^[a-z]+\d+$/);
  });
});
