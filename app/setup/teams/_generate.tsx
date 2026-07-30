"use client";

import { useActionState } from "react";
import { generateSchedule, type GenerateState } from "../actions";
import { ErrorNote } from "../../_components/form-bits";

export function GenerateScheduleButton({ ready }: { ready: boolean }) {
  const [state, action, pending] = useActionState(
    generateSchedule,
    {} as GenerateState,
  );

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Generate the draw now? This locks the roster and publishes a preview. Scores and voting stay locked until you start the tournament.",
          )
        ) {
          event.preventDefault();
        }
      }}
      className="space-y-2"
    >
      <button
        type="submit"
        disabled={pending || !ready}
        className="w-full rounded-lg bg-brand px-4 py-3 text-base font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? "Drawing groups…" : "Publish preview — draw the groups"}
      </button>
      {!ready && (
        <p className="text-center text-xs text-foreground/50">
          Add at least 2 teams to generate the schedule.
        </p>
      )}
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
    </form>
  );
}
