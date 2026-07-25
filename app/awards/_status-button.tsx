"use client";

import { useActionState } from "react";
import { setVotingStatus, type VoteState } from "./actions";

export function VotingStatusButton({
  to,
  label,
}: {
  to: "open" | "closed" | "pending";
  label: string;
}) {
  const [state, action, pending] = useActionState(
    setVotingStatus,
    {} as VoteState,
  );
  return (
    <form action={action}>
      <input type="hidden" name="status" value={to} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/[.03] disabled:opacity-60"
      >
        {pending ? "Saving…" : label}
      </button>
      {state.error && (
        <p role="alert" className="mt-1 max-w-64 text-xs text-red-800">
          {state.error}
        </p>
      )}
    </form>
  );
}
