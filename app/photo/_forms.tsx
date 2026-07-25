"use client";

import { useActionState } from "react";
import {
  savePhotoEmail,
  togglePhotoDone,
  type PhotoState,
} from "./actions";

const inputCls =
  "mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

export function PhotoEmailForm({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState(
    savePhotoEmail,
    {} as PhotoState,
  );
  return (
    <form action={action} className="mt-4">
      <label className="block">
        <span className="text-sm font-medium">Your email</span>
        <input
          name="email"
          type="email"
          defaultValue={email ?? ""}
          placeholder="you@example.com"
          maxLength={254}
          required
          className={inputCls}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save my email"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function PhotoDoneButton({ done }: { done: boolean }) {
  const [state, action, pending] = useActionState(
    togglePhotoDone,
    {} as PhotoState,
  );
  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="done" value={done ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        className={
          done
            ? "w-full rounded-xl bg-brand/15 px-4 py-3 text-sm font-semibold text-brand-dark ring-1 ring-brand/30 disabled:opacity-60"
            : "w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium hover:bg-black/[.03] disabled:opacity-60"
        }
      >
        {pending
          ? "Saving…"
          : done
            ? "✓ Done — tap to undo"
            : "Mark as completed"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
    </form>
  );
}
