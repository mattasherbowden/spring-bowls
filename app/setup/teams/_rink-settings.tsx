"use client";

import { useActionState } from "react";
import {
  updateSetupRinks,
  type PreviewEditState,
} from "../actions";
import { ErrorNote } from "../../_components/form-bits";

export function RinkSettings({
  tournamentId,
  rinkCount,
}: {
  tournamentId: string;
  rinkCount: number;
}) {
  const [state, action, pending] = useActionState(
    updateSetupRinks,
    {} as PreviewEditState,
  );

  return (
    <form
      action={action}
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
    >
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <div className="flex items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="text-sm font-semibold">Available rinks</span>
          <span className="mt-0.5 block text-xs text-foreground/55">
            Used when the next draw is published.
          </span>
          <input
            name="rinkCount"
            type="number"
            min={1}
            max={20}
            step={1}
            required
            defaultValue={rinkCount}
            className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save rinks"}
        </button>
      </div>
      {state.done && !state.error && (
        <p className="mt-2 text-xs font-medium text-brand-dark">
          Rink count saved ✓
        </p>
      )}
      {state.error && (
        <div className="mt-2">
          <ErrorNote>{state.error}</ErrorNote>
        </div>
      )}
    </form>
  );
}
