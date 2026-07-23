"use client";

import { useActionState, useState } from "react";
import { planTournament } from "@/lib/domain/planner";
import { createTournament, type CreateState } from "./actions";
import { ErrorNote } from "../_components/form-bits";

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-foreground/70">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-brand"
      />
    </label>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold text-foreground">{value}</p>
      {sub && <p className="text-xs text-foreground/60">{sub}</p>}
    </div>
  );
}

function summariseGroups(groups: number[]): string {
  if (!groups.length) return "—";
  const counts = new Map<number, number>();
  for (const s of groups) counts.set(s, (counts.get(s) ?? 0) + 1);
  if (counts.size === 1) {
    const size = groups[0];
    return `${groups.length} group${groups.length > 1 ? "s" : ""} of ${size}`;
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, n]) => `${n}×${size}`);
  return `${groups.length} groups (${parts.join(" + ")})`;
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function finishTime(start: string, mins: number): string {
  const [hh, mm] = start.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return "—";
  const total = hh * 60 + mm + mins;
  const fh = Math.floor(total / 60) % 24;
  const fm = total % 60;
  const ampm = fh < 12 ? "am" : "pm";
  const h12 = ((fh + 11) % 12) + 1;
  return `${h12}:${String(fm).padStart(2, "0")} ${ampm}`;
}

export function SetupWizard() {
  const [teams, setTeams] = useState(12);
  const [teamSize, setTeamSize] = useState(2);
  const [rinks, setRinks] = useState(3);
  const [endsPerGame, setEnds] = useState(2);
  const [minutesPerEnd, setMinPerEnd] = useState(12);
  const [advance, setAdvance] = useState<1 | 2>(2);
  const [preferredGroupSize, setGroupSize] = useState(4);
  const [start, setStart] = useState("10:00");
  const [createState, createAction, creating] = useActionState(
    createTournament,
    {} as CreateState,
  );

  const plan = planTournament({
    teams,
    teamSize,
    rinks,
    endsPerGame,
    minutesPerEnd,
    advance,
    preferredGroupSize,
  });

  const perTeam =
    plan.fixturesPerTeam.min === plan.fixturesPerTeam.max
      ? `${plan.fixturesPerTeam.min}`
      : `${plan.fixturesPerTeam.min}–${plan.fixturesPerTeam.max}`;

  return (
    <div className="space-y-5">
      <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <Slider label="Teams" value={teams} min={2} max={40} onChange={setTeams} />
        <Slider
          label="Players per team"
          value={teamSize}
          min={1}
          max={4}
          onChange={setTeamSize}
        />
        <Slider
          label="Rinks (games at once)"
          value={rinks}
          min={1}
          max={10}
          onChange={setRinks}
        />
        <Slider
          label="Ends per game"
          value={endsPerGame}
          min={1}
          max={6}
          onChange={setEnds}
        />
        <Slider
          label="Minutes per end"
          value={minutesPerEnd}
          min={3}
          max={20}
          onChange={setMinPerEnd}
          suffix=" min"
        />
        <Slider
          label="Preferred group size"
          value={preferredGroupSize}
          min={3}
          max={6}
          onChange={setGroupSize}
        />
        <div>
          <span className="text-sm font-medium">Who advances from each group</span>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([1, 2] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAdvance(n)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  advance === n
                    ? "border-brand bg-brand/10 text-brand-dark"
                    : "border-black/10 text-foreground/70"
                }`}
              >
                Top {n}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-sm font-medium">Start time</span>
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-2 block rounded-lg border border-black/10 bg-white px-3 py-2 text-base text-black"
          />
        </label>
      </div>

      <div className="rounded-2xl bg-brand/5 p-5 ring-1 ring-brand/15">
        <h2 className="text-sm font-medium uppercase tracking-wide text-brand-dark">
          The plan
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <Stat
            label="Format"
            value={summariseGroups(plan.groups)}
            sub={`top ${advance} into the knockout`}
          />
          <Stat
            label="Players"
            value={`${plan.headcount}`}
            sub={`${teams} teams of ${teamSize}`}
          />
          <Stat label="Group games each" value={perTeam} sub="round-robin" />
          <Stat
            label="Total games"
            value={`${plan.totalGames}`}
            sub={`${plan.groupGames} group + ${plan.knockoutGames} knockout`}
          />
          <Stat
            label="Knockout"
            value={plan.qualifiers >= 2 ? `${plan.qualifiers} qualify` : "—"}
            sub={
              plan.qualifiers >= 2
                ? `${plan.knockoutRounds} rounds${plan.byes ? `, ${plan.byes} byes` : ""}`
                : "too few to qualify"
            }
          />
          <Stat
            label="Est. time"
            value={`~${fmtDuration(plan.estMinutes)}`}
            sub={`finishes ~${finishTime(start, plan.estMinutes)}`}
          />
        </div>
        <p className="mt-4 text-xs text-foreground/50">
          A rough budget — deciders, breaks and slow games add slack.
        </p>
      </div>

      <form action={createAction} className="space-y-3">
        <input type="hidden" name="teamSize" value={teamSize} />
        <input type="hidden" name="rinks" value={rinks} />
        <input type="hidden" name="endsPerGame" value={endsPerGame} />
        <input type="hidden" name="minutesPerEnd" value={minutesPerEnd} />
        <input type="hidden" name="advance" value={advance} />
        <input
          type="hidden"
          name="preferredGroupSize"
          value={preferredGroupSize}
        />
        <input type="hidden" name="startTime" value={start} />
        <button
          type="submit"
          disabled={creating}
          className="w-full rounded-lg bg-brand px-4 py-3 text-base font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {creating ? "Creating…" : "Create tournament — add teams"}
        </button>
        {createState.error && <ErrorNote>{createState.error}</ErrorNote>}
      </form>
    </div>
  );
}
