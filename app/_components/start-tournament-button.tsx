"use client";

import { useActionState } from "react";
import {
  startTournamentPlay,
  type StartPlayState,
} from "../setup/actions";

export function StartTournamentButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState(
    startTournamentPlay,
    {} as StartPlayState,
  );

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Start the tournament now? Players will immediately be able to enter scores and vote for Bowl of the Day.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        disabled={pending || state.done}
        className={
          compact
            ? "rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
            : "w-full rounded-lg bg-brand px-4 py-3 text-base font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        }
      >
        {pending
          ? "Opening fixtures…"
          : state.done
            ? "Tournament started ✓"
            : "Start tournament — open fixtures & Bowl voting"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {state.error}
        </p>
      )}
    </form>
  );
}
