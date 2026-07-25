import { describe, expect, it } from "vitest";
import { isoToZonedInput, zonedInputToIso } from "./date-time";

describe("London event date conversion", () => {
  it("stores British Summer Time as the correct instant", () => {
    expect(
      zonedInputToIso("2026-08-01T12:30", "Europe/London"),
    ).toBe("2026-08-01T11:30:00.000Z");
  });

  it("stores winter wall-clock time without a DST offset", () => {
    expect(
      zonedInputToIso("2026-01-10T12:30", "Europe/London"),
    ).toBe("2026-01-10T12:30:00.000Z");
  });

  it("formats an instant back into the London wall-clock", () => {
    expect(
      isoToZonedInput("2026-08-01T11:30:00.000Z", "Europe/London"),
    ).toBe("2026-08-01T12:30");
  });
});
