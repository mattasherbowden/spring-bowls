"use client";

import { useActionState } from "react";
import { generateRecoveryCode, type RecoveryState } from "../../actions";

export function RecoveryPanel({ hasCode }: { hasCode: boolean }) {
  const [state, action, pending] = useActionState(
    generateRecoveryCode,
    {} as RecoveryState,
  );

  if (state.code) {
    return (
      <div className="mt-4 rounded-lg bg-amber-50 p-4 ring-1 ring-amber-200">
        <p className="text-sm font-semibold text-amber-900">
          Save this now — it&apos;s shown only once
        </p>
        <p className="mt-2 font-mono text-xl tracking-wide">{state.code}</p>
        <p className="mt-2 text-xs text-amber-800">
          Write it down or store it in your password manager. Keep it separate
          from your password. It won&apos;t be shown again.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-foreground/70">
        {hasCode
          ? "A recovery code is set. Generating a new one replaces it (the old one stops working)."
          : "No recovery code yet — generate one now."}
      </p>
      <form action={action} className="mt-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending
            ? "Generating…"
            : hasCode
              ? "Generate a new code"
              : "Generate recovery code"}
        </button>
        {state.error && (
          <p className="mt-2 text-xs text-red-800">{state.error}</p>
        )}
      </form>
    </div>
  );
}
