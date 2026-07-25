"use client";

import { useActionState, useState } from "react";
import {
  confirmQualificationTie,
  type QualificationTieState,
} from "./actions";

type TiedTeam = { id: string; label: string };

export function QualificationTieResolver({
  tournamentId,
  groupLabel,
  teams,
  initialOrder,
  resolved,
}: {
  tournamentId: string;
  groupLabel: string;
  teams: TiedTeam[];
  initialOrder: string[];
  resolved: boolean;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [state, action, pending] = useActionState(
    confirmQualificationTie,
    {} as QualificationTieState,
  );
  const label = (id: string) => teams.find((team) => team.id === id)?.label ?? "—";

  return (
    <form
      action={action}
      className={`mt-3 rounded-xl p-3 ring-1 ${
        resolved
          ? "bg-brand/5 text-brand-dark ring-brand/20"
          : "bg-amber-50 text-amber-950 ring-amber-200"
      }`}
    >
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="groupLabel" value={groupLabel} />
      <input type="hidden" name="orderedTeamIds" value={JSON.stringify(order)} />
      <p className="text-xs font-semibold">
        {resolved
          ? "✓ Exact tie order confirmed"
          : "⚠ Exact tie affects qualification — knockout waiting"}
      </p>
      <p className="mt-1 text-xs leading-relaxed">
        Use your bowl-off or drawn-lots result to put every tied team in order.
        This decision is saved and shown explicitly.
      </p>
      <div className="mt-2 space-y-2">
        {order.map((id, index) => (
          <label key={`${index}-${id}`} className="flex items-center gap-2 text-xs">
            <span className="w-10 shrink-0 font-semibold">
              {index + 1}
              {index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"}
            </span>
            <select
              value={id}
              onChange={(event) =>
                setOrder((current) =>
                  current.map((teamId, position) =>
                    position === index ? event.target.value : teamId,
                  ),
                )
              }
              className="min-h-11 flex-1 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black"
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {new Set(order).size !== order.length && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-800">
          Choose each tied team exactly once.
        </p>
      )}
      <button
        type="submit"
        disabled={pending || new Set(order).size !== order.length}
        className="mt-3 min-h-11 w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving tie order…" : resolved ? "Update tie order" : "Confirm tie order"}
      </button>
      {state.done && !state.error && (
        <p className="mt-2 text-xs font-medium text-brand-dark">
          Tie order saved. Knockout places updated ✓
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-800">
          {state.error}
        </p>
      )}
      {resolved && (
        <p className="mt-2 text-[11px] text-foreground/60">
          Current order: {order.map(label).join(" → ")}
        </p>
      )}
    </form>
  );
}
