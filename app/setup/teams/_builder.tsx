"use client";

import { useActionState, useState } from "react";
import { addTeam, type AddTeamState } from "../actions";
import { ErrorNote } from "../../_components/form-bits";

type TeamRow = {
  id: string;
  name: string | null;
  players: { display_name: string; nationality: string | null }[];
};

function flag(nat: string | null): string {
  if (nat === "brit") return " 🇬🇧";
  if (nat === "kiwi") return " 🥝";
  return "";
}

export function TeamBuilder({
  teamSize,
  plannedTeams,
  teams,
}: {
  teamSize: number;
  plannedTeams: number;
  teams: TeamRow[];
}) {
  const [state, action, pending] = useActionState(addTeam, {} as AddTeamState);
  const [addExtra, setAddExtra] = useState(false);
  const atLimit = teams.length >= plannedTeams;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Teams</h2>
          <span className="text-sm text-foreground/50">
            {teams.length} of {plannedTeams} added
          </span>
        </div>
        {teams.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">
            No teams yet — add your first below.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {teams.map((t) => (
              <li
                key={t.id}
                className="rounded-lg border border-black/5 bg-brand/5 px-3 py-2 text-sm"
              >
                <span className="font-medium">
                  {t.name ?? t.players.map((p) => p.display_name).join(" & ")}
                </span>
                <span className="ml-2 text-foreground/60">
                  {t.players
                    .map((p) => `${p.display_name}${flag(p.nationality)}`)
                    .join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
        {teams.length < plannedTeams ? (
          <p className="mt-3 text-xs text-foreground/50">
            {plannedTeams - teams.length} more to go.
          </p>
        ) : (
          <p className="mt-3 text-xs font-medium text-brand-dark">
            All {teams.length} teams in — you can still add or edit. Generating
            the schedule is the next step (coming soon).
          </p>
        )}
      </div>

      {state.created && (
        <div className="rounded-2xl bg-amber-50 p-5 ring-1 ring-amber-200">
          <h3 className="text-sm font-semibold text-amber-900">
            Save these logins — shown once
          </h3>
          <p className="mt-1 text-xs text-amber-800">
            Team: {state.created.teamName}
          </p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-amber-800">
                <th className="font-medium">Player</th>
                <th className="font-medium">Username</th>
                <th className="font-medium">Password</th>
              </tr>
            </thead>
            <tbody>
              {state.created.players.map((p) => (
                <tr key={p.username} className="border-t border-amber-200">
                  <td className="py-1.5">{p.displayName}</td>
                  <td className="py-1.5 font-mono">{p.username}</td>
                  <td className="py-1.5 font-mono">{p.password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!atLimit || addExtra ? (
        <form
          action={action}
          className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
        >
        <h2 className="text-lg font-semibold">Add a team</h2>
        <label className="block">
          <span className="text-sm font-medium">Team name (optional)</span>
          <input
            name="teamName"
            placeholder="e.g. The Jack Attack"
            className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </label>

        {Array.from({ length: teamSize }).map((_, i) => (
          <div key={i} className="rounded-lg border border-black/5 p-3">
            <span className="text-sm font-medium">Player {i + 1}</span>
            <input
              name={`name_${i}`}
              placeholder="Name"
              autoCapitalize="words"
              className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <NatRadio index={i} value="brit" label="🇬🇧 Brit" defaultChecked={i === 0} />
              <NatRadio index={i} value="kiwi" label="🥝 Kiwi" defaultChecked={i === 1} />
            </div>
          </div>
        ))}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-brand px-4 py-2.5 text-base font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "Creating logins…" : "Add team"}
        </button>
        {state.error && <ErrorNote>{state.error}</ErrorNote>}
        </form>
      ) : (
        <div className="rounded-2xl bg-brand/5 p-5 text-center ring-1 ring-brand/15">
          <p className="text-sm font-medium text-brand-dark">
            All {plannedTeams} teams are in 🎉
          </p>
          <p className="mt-1 text-xs text-foreground/60">
            Generating the schedule is the next step.
          </p>
          <button
            type="button"
            onClick={() => setAddExtra(true)}
            className="mt-3 text-sm font-medium text-brand hover:text-brand-dark"
          >
            + Add an extra team anyway
          </button>
        </div>
      )}
    </div>
  );
}

function NatRadio({
  index,
  value,
  label,
  defaultChecked,
}: {
  index: number;
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand/10">
      <input
        type="radio"
        name={`nat_${index}`}
        value={value}
        defaultChecked={defaultChecked}
        className="accent-brand"
      />
      {label}
    </label>
  );
}
