"use client";

import { useActionState } from "react";
import {
  createHelper,
  resetHelperPassword,
  removeHelper,
  type HelperState,
  type HelperActionState,
} from "../actions";

type Helper = { id: string; display_name: string; username: string };

const inputCls =
  "mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

function Credentials({
  username,
  password,
}: {
  username: string;
  password: string;
}) {
  return (
    <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm ring-1 ring-amber-200">
      <p className="font-semibold text-amber-900">
        Give these to your helper — shown once
      </p>
      <p className="mt-1">
        Username: <span className="font-mono">{username}</span>
      </p>
      <p>
        Password: <span className="font-mono">{password}</span>
      </p>
    </div>
  );
}

function AddHelper() {
  const [state, action, pending] = useActionState(
    createHelper,
    {} as HelperState,
  );
  return (
    <form
      action={action}
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
    >
      <h2 className="text-lg font-semibold">Add a helper</h2>
      <label className="mt-3 block">
        <span className="text-sm font-medium">Helper&apos;s name</span>
        <input name="displayName" className={inputCls} placeholder="e.g. Jon" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add helper"}
      </button>
      {state.created && (
        <Credentials
          username={state.created.username}
          password={state.created.password}
        />
      )}
      {state.error && <p className="mt-2 text-sm text-red-800">{state.error}</p>}
    </form>
  );
}

function HelperRow({ helper }: { helper: Helper }) {
  const [rState, rAction, rPending] = useActionState(
    resetHelperPassword,
    {} as HelperActionState,
  );
  const [dState, dAction, dPending] = useActionState(
    removeHelper,
    {} as HelperActionState,
  );
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{helper.display_name}</p>
          <p className="truncate font-mono text-xs text-foreground/50">
            @{helper.username}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <form action={rAction}>
            <input type="hidden" name="profileId" value={helper.id} />
            <button
              type="submit"
              disabled={rPending}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/[.03] disabled:opacity-60"
            >
              {rPending ? "…" : "Reset password"}
            </button>
          </form>
          <form action={dAction}>
            <input type="hidden" name="profileId" value={helper.id} />
            <button
              type="submit"
              disabled={dPending}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              {dPending ? "…" : "Remove"}
            </button>
          </form>
        </div>
      </div>
      {rState.reset && (
        <Credentials
          username={rState.reset.username}
          password={rState.reset.password}
        />
      )}
      {(rState.error || dState.error) && (
        <p className="mt-2 text-sm text-red-800">
          {rState.error || dState.error}
        </p>
      )}
    </div>
  );
}

export function HelperManager({ helpers }: { helpers: Helper[] }) {
  return (
    <div className="space-y-4">
      <AddHelper />
      {helpers.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground/60">
            Current helpers
          </h3>
          {helpers.map((h) => (
            <HelperRow key={h.id} helper={h} />
          ))}
        </div>
      ) : (
        <p className="px-1 text-sm text-foreground/50">No helpers yet.</p>
      )}
    </div>
  );
}
