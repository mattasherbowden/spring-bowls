"use client";

import { useActionState, useState } from "react";
import { resetTournament, type GenerateState } from "../actions";

const CONFIRMATION = "DELETE TEST ROSTER";

export function ResetButton({
  live,
  tournamentId,
}: {
  live: boolean;
  tournamentId: string;
}) {
  const [state, action, pending] = useActionState(
    resetTournament,
    {} as GenerateState,
  );
  const [confirm, setConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  return (
    <form action={action} className="text-center">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      {!confirm ? (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="text-xs font-medium text-red-700 hover:text-red-800"
        >
          {live
            ? "Replace this test roster before the event"
            : "Reset — delete all teams & logins and start over"}
        </button>
      ) : (
        <div className="mx-auto max-w-sm space-y-3 rounded-xl bg-red-50 p-4 ring-1 ring-red-200">
          <div className="text-left">
            <p className="text-sm font-semibold text-red-900">
              Permanently replace the test event
            </p>
            <p className="mt-1 text-xs leading-relaxed text-red-800">
              This deletes every test team, player login, fixture, score, vote
              and photo assignment. Your owner account, helpers and event-page
              details remain.
            </p>
          </div>
          <label className="block text-left">
            <span className="text-xs font-medium text-red-900">
              Type {CONFIRMATION} to continue
            </span>
            <input
              name="confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-black outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200"
            />
          </label>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirm(false);
                setConfirmation("");
              }}
              className="min-h-11 rounded-lg border border-black/10 px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || confirmation !== CONFIRMATION}
              className="min-h-11 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {pending ? "Deleting test data…" : "Delete test roster"}
            </button>
          </div>
        </div>
      )}
      {state.error && <p className="mt-2 text-xs text-red-800">{state.error}</p>}
    </form>
  );
}
