export type EventInfoData = {
  event_at: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_phone: string | null;
  details: string | null;
};

export function EventInfo({ ev }: { ev: EventInfoData }) {
  const hasVenue = ev.venue_name || ev.venue_address || ev.venue_phone;
  const mapQuery = encodeURIComponent(
    `${ev.venue_name ?? ""} ${ev.venue_address ?? ""}`.trim(),
  );
  // Split the free-text details into blank-line-separated sections so each reads
  // as its own card instead of one pasted-message blob.
  const sections = (ev.details ?? "")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      return { title: lines[0].trim(), body: lines.slice(1).join("\n").trim() };
    });
  return (
    <>
      {sections.length > 0 && (
        <section className="mt-6">
          <h2 className="px-1 text-lg font-semibold">On the day</h2>
          <div className="mt-2 grid gap-2">
            {sections.map((s, i) => (
              <div
                key={i}
                className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"
              >
                <h3 className="font-display text-base font-semibold">
                  {s.title}
                </h3>
                {s.body && (
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground/70">
                    {s.body}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {hasVenue && (
        <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-lg font-semibold">📍 Venue</h2>
          {ev.venue_name && <p className="mt-2 font-medium">{ev.venue_name}</p>}
          {ev.venue_address && (
            <a
              href={`https://maps.google.com/?q=${mapQuery}`}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block text-sm text-brand hover:text-brand-dark"
            >
              {ev.venue_address}
            </a>
          )}
          {ev.venue_phone && (
            <a
              href={`tel:${ev.venue_phone.replace(/\s+/g, "")}`}
              className="mt-1 block text-sm text-foreground/60"
            >
              {ev.venue_phone}
            </a>
          )}
        </section>
      )}
    </>
  );
}
