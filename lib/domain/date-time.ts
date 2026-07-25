const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function zonedParts(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

function asUtc(parts: DateParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
}

/** Format a real instant for a timezone-pinned datetime-local input. */
export function isoToZonedInput(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Interpret a datetime-local wall-clock as belonging to the named timezone. */
export function zonedInputToIso(local: string, timeZone: string): string {
  const match = local.match(LOCAL_RE);
  if (!match) return "";
  const wanted: DateParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const wantedUtc = asUtc(wanted);

  // Start by pretending the wall-clock is UTC, then iteratively correct by the
  // zone offset. A second pass handles dates around daylight-saving changes.
  let candidate = wantedUtc;
  for (let pass = 0; pass < 3; pass++) {
    candidate += wantedUtc - asUtc(zonedParts(new Date(candidate), timeZone));
  }
  return new Date(candidate).toISOString();
}
