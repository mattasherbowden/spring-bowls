"use client";

import { useActionState } from "react";
import {
  refreshKnockout,
  type GenerateState,
} from "../setup/actions";

export function RefreshKnockoutButton() {
  const [state, action, pending] = useActionState(
    refreshKnockout,
    {} as GenerateState,
  );
  return (
    <form action={action} className="mt-3">
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-brand hover:text-brand-dark disabled:opacity-60"
      >
        {pending ? "Refreshing…" : "Refresh knockout"}
      </button>
      {state.done && (
        <p className="mt-1 text-xs font-medium text-brand-dark">Refreshed ✓</p>
      )}
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-red-800">
          {state.error}
        </p>
      )}
    </form>
  );
}
