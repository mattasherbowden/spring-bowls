export type PlayStatus = "preview" | "open";

export function isPlayOpen(status: PlayStatus | string | null | undefined) {
  return status === "open";
}

/**
 * Tournament times are stored as a local HH:mm clock value. Supabase may
 * return seconds as well, so accept both 13:00 and 13:00:00.
 */
export function formatFixtureOpenTime(
  value: string | null | undefined,
): string {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return "when the organiser starts play";

  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour < 12 ? "am" : "pm";
  const hour12 = ((hour + 11) % 12) + 1;
  return `${hour12}:${minute}${suffix}`;
}
