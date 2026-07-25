import { describe, expect, it } from "vitest";
import { loginErrorMessage, syntheticEmail } from "./auth";

describe("syntheticEmail", () => {
  it("canonicalises the username", () => {
    expect(syntheticEmail("  Will.S  ")).toBe("will.s@springbowls.local");
  });
});

describe("loginErrorMessage", () => {
  it("distinguishes a shared rate-limit from a wrong password", () => {
    expect(loginErrorMessage({ status: 429 })).toContain("wait a minute");
    expect(loginErrorMessage({ code: "over_request_rate_limit" })).toContain(
      "wait a minute",
    );
  });

  it("distinguishes transient server and network failures", () => {
    expect(loginErrorMessage({ status: 503 })).toContain("reach the server");
    expect(loginErrorMessage({ message: "fetch failed" })).toContain(
      "check your signal",
    );
  });

  it("keeps invalid credentials deliberately generic", () => {
    expect(loginErrorMessage({ status: 400, code: "invalid_credentials" })).toBe(
      "That username and password do not match.",
    );
  });
});
