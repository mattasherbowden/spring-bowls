"use client";

import { useActionState, useState } from "react";
import { resetTournament, type GenerateState } from "../actions";

export function ResetButton() {
  const [state, action, pending] = useActionState(
    resetTournament,
    {} as GenerateState,
  );
  const [confirm, setConfirm] = useState(false);

  return (
    <form action={action} className="text-center">
      {!confirm ? (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="text-xs font-medium text-red-700 hover:text-red-800"
        >
          Reset — delete all teams &amp; logins and start over
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-red-800">
            This permanently deletes every team, login and the schedule. You
            (owner) stay logged in.
          </p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => setConfirm(false)}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {pending ? "Deleting…" : "Yes, delete everything"}
            </button>
          </div>
        </div>
      )}
      {state.error && <p className="mt-2 text-xs text-red-800">{state.error}</p>}
    </form>
  );
}
