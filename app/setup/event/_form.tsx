"use client";

import { useActionState, useState } from "react";
import { saveEvent, type EventState } from "../actions";
import { isoToZonedInput, zonedInputToIso } from "@/lib/domain/date-time";

const EVENT_TIME_ZONE = "Europe/London";

const inputCls =
  "mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

export function EventForm({
  eventAt,
  venueName,
  venueAddress,
  venuePhone,
  details,
  albumUrl,
}: {
  eventAt: string | null;
  venueName: string;
  venueAddress: string;
  venuePhone: string;
  details: string;
  albumUrl: string;
}) {
  const [dt, setDt] = useState(() =>
    eventAt ? isoToZonedInput(eventAt, EVENT_TIME_ZONE) : "",
  );

  const [state, action, pending] = useActionState(saveEvent, {} as EventState);
  const iso = dt ? zonedInputToIso(dt, EVENT_TIME_ZONE) : "";

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
    >
      <input type="hidden" name="eventAt" value={iso} />
      <label className="block">
        <span className="text-sm font-medium">Date and time</span>
        <span className="mt-0.5 block text-xs text-foreground/50">
          London time, wherever you edit it from.
        </span>
        <input
          type="datetime-local"
          value={dt}
          onChange={(e) => setDt(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Venue name</span>
        <input name="venueName" defaultValue={venueName} className={inputCls} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Venue address</span>
        <input
          name="venueAddress"
          defaultValue={venueAddress}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Venue phone</span>
        <input name="venuePhone" defaultValue={venuePhone} className={inputCls} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Photo album link</span>
        <span className="mt-0.5 block text-xs text-foreground/50">
          The Apple Shared Album URL for the photo-bomb challenge.
        </span>
        <input
          name="photoAlbumUrl"
          defaultValue={albumUrl}
          placeholder="https://www.icloud.com/sharedalbum/…"
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Details</span>
        <span className="mt-0.5 block text-xs text-foreground/50">
          Schedule, dress code, drinks, awards, plans — anything. Line breaks are
          kept exactly as you type them.
        </span>
        <textarea
          name="details"
          defaultValue={details}
          rows={14}
          className={`${inputCls} leading-relaxed`}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2.5 text-base font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save event details"}
      </button>
      {state.done && (
        <p className="text-sm font-medium text-brand-dark">
          Saved ✓ — it&apos;s live on the landing page now.
        </p>
      )}
      {state.error && <p className="text-sm text-red-800">{state.error}</p>}
    </form>
  );
}
