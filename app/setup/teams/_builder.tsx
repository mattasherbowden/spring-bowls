"use client";

import { useActionState, useState } from "react";
import {
  addTeam,
  removeTeam,
  updateTeam,
  type AddTeamState,
  type EditTeamState,
} from "../actions";
import { ErrorNote } from "../../_components/form-bits";

type TeamRow = {
  id: string;
  name: string | null;
  players: {
    id: string;
    display_name: string;
    nationality: string | null;
  }[];
};

function flag(nat: string | null): string {
  if (nat === "brit") return " 🇬🇧";
  if (nat === "kiwi") return " 🇳🇿";
  return "";
}

export function TeamBuilder({
  tournamentId,
  submissionKey,
  teamSize,
  plannedTeams,
  teams,
  rosterLocked,
  teamEditingAllowed,
}: {
  tournamentId: string;
  submissionKey: string;
  teamSize: number;
  plannedTeams: number;
  teams: TeamRow[];
  rosterLocked: boolean;
  teamEditingAllowed: boolean;
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
            {teams.map((team) => (
              <TeamListItem
                key={team.id}
                tournamentId={tournamentId}
                team={team}
                editable={teamEditingAllowed}
                removable={!rosterLocked}
                publishedPreview={rosterLocked}
              />
            ))}
          </ul>
        )}
        {rosterLocked ? (
          <p className="mt-3 text-xs font-medium text-brand-dark">
            {teams.length} team{teams.length === 1 ? "" : "s"} in the published
            draw — teams cannot be added or removed
            {teamEditingAllowed ? ", but names can be corrected safely." : "."}
          </p>
        ) : teams.length < plannedTeams ? (
          <p className="mt-3 text-xs text-foreground/50">
            {plannedTeams - teams.length} more to go.
          </p>
        ) : (
          <p className="mt-3 text-xs font-medium text-brand-dark">
            {teams.length === plannedTeams
              ? `All ${plannedTeams} teams added — ready to generate the draw.`
              : `${teams.length} teams added (${teams.length - plannedTeams} over the planned ${plannedTeams}) — ready to generate the draw.`}
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
                  <td className="py-1.5 font-mono">
                    {p.password || (
                      <span className="font-sans text-xs text-amber-700">
                        uses your login
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rosterLocked ? (
        <div className="rounded-2xl bg-amber-50 p-5 text-center ring-1 ring-amber-200">
          <p className="text-sm font-semibold text-amber-900">
            Roster locked — the draw is published
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Adding a team now would leave them without fixtures. Scores remain
            locked until the organiser starts play. Use Rename / replace above
            for a substitute without changing the draw.
          </p>
        </div>
      ) : !atLimit || addExtra ? (
        <form
          action={action}
          className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
        >
        <input type="hidden" name="submitKey" value={submissionKey} />
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
              <NatRadio index={i} value="kiwi" label="🇳🇿 Kiwi" defaultChecked={i === 1} />
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-foreground/60">
              <input
                type="checkbox"
                name={`me_${i}`}
                className="accent-brand"
              />
              This is me — link to my organiser login (no separate password)
            </label>
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
            {teams.length === plannedTeams
              ? `All ${plannedTeams} teams are in 🎉`
              : `${teams.length} teams added 🎉`}
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

function TeamListItem({
  tournamentId,
  team,
  editable,
  removable,
  publishedPreview,
}: {
  tournamentId: string;
  team: TeamRow;
  editable: boolean;
  removable: boolean;
  publishedPreview: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [teamName, setTeamName] = useState(team.name ?? "");
  const [players, setPlayers] = useState(() =>
    team.players.map((player) => ({
      id: player.id,
      displayName: player.display_name,
      nationality:
        player.nationality === "kiwi" ? ("kiwi" as const) : ("brit" as const),
    })),
  );
  const [editState, editAction, editPending] = useActionState(
    updateTeam,
    {} as EditTeamState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeTeam,
    {} as EditTeamState,
  );
  const label = team.name ?? team.players.map((player) => player.display_name).join(" & ");
  const updatePlayerName = (playerId: string, displayName: string) => {
    const generatedName = players.map((player) => player.displayName).join(" & ");
    const nextPlayers = players.map((player) =>
      player.id === playerId ? { ...player, displayName } : player,
    );
    if (teamName === generatedName) {
      setTeamName(nextPlayers.map((player) => player.displayName).join(" & "));
    }
    setPlayers(nextPlayers);
  };

  if (editing && editable) {
    return (
      <li className="rounded-xl border border-brand/20 bg-white p-3 text-sm">
        <form action={editAction} className="space-y-3">
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <input type="hidden" name="teamId" value={team.id} />
          <input type="hidden" name="players" value={JSON.stringify(players)} />
          <p className="text-xs text-foreground/60">
            {publishedPreview
              ? "Rename or replace a player without changing any group or fixture. Their existing username and password stay the same."
              : "Correct the displayed names here; existing usernames and passwords stay the same. Remove and re-add the team if you need new logins."}
          </p>
          <label className="block">
            <span className="text-xs font-medium">Team name (optional)</span>
            <input
              name="teamName"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </label>
          {players.map((player, index) => (
            <div key={player.id} className="rounded-lg border border-black/5 p-3">
              <label className="block">
                <span className="text-xs font-medium">Player {index + 1}</span>
                <input
                  value={player.displayName}
                  onChange={(event) =>
                    updatePlayerName(player.id, event.target.value)
                  }
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["brit", "kiwi"] as const).map((nationality) => (
                  <label
                    key={nationality}
                    className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand/10"
                  >
                    <input
                      type="radio"
                      name={`edit_nat_${player.id}`}
                      checked={player.nationality === nationality}
                      onChange={() =>
                        setPlayers((current) =>
                          current.map((item) =>
                            item.id === player.id
                              ? { ...item, nationality }
                              : item,
                          ),
                        )
                      }
                      className="accent-brand"
                    />
                    {nationality === "brit" ? "🇬🇧 Brit" : "🇳🇿 Kiwi"}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={editPending}
              className="min-h-11 rounded-lg border border-black/10 px-3 py-2 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={editPending}
              className="min-h-11 rounded-lg bg-brand px-3 py-2 font-semibold text-white disabled:opacity-60"
            >
              {editPending ? "Saving…" : "Save team"}
            </button>
          </div>
          {editState.done && (
            <p className="text-center text-xs font-medium text-brand-dark">
              Team saved ✓
            </p>
          )}
          {editState.error && <ErrorNote>{editState.error}</ErrorNote>}
        </form>
        {removable && (
          <form
            action={removeAction}
            onSubmit={(event) => {
              if (
                !window.confirm(
                  `Remove ${label} and delete their generated logins? This cannot be undone.`,
                )
              ) {
                event.preventDefault();
              }
            }}
            className="mt-3 border-t border-black/5 pt-3 text-center"
          >
            <input type="hidden" name="tournamentId" value={tournamentId} />
            <input type="hidden" name="teamId" value={team.id} />
            <button
              type="submit"
              disabled={removePending}
              className="text-xs font-medium text-red-700 disabled:opacity-60"
            >
              {removePending ? "Removing…" : "Remove this team & logins"}
            </button>
            {removeState.error && (
              <p role="alert" className="mt-2 text-xs text-red-800">
                {removeState.error}
              </p>
            )}
          </form>
        )}
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-black/5 bg-brand/5 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-medium">{label}</span>
          <span className="ml-2 text-foreground/60">
            {team.players
              .map((player) => `${player.display_name}${flag(player.nationality)}`)
              .join(", ")}
          </span>
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 text-xs font-medium text-brand hover:text-brand-dark"
          >
            {publishedPreview ? "Rename / replace" : "Edit"}
          </button>
        )}
      </div>
    </li>
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
