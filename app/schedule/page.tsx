import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeStandings } from "@/lib/domain/standings";
import { buildBracket } from "@/lib/domain/bracket";
import { refreshKnockout } from "../setup/actions";
import type { Fixture } from "@/lib/domain/types";

type PlayerLite = { display_name: string; nationality: string | null };
type TeamRow = {
  id: string;
  name: string | null;
  group_label: string | null;
  players: PlayerLite[];
};
type FixtureRow = {
  id: string;
  stage: string;
  group_label: string | null;
  round: number | null;
  rink: number | null;
  order_index: number;
  team_a_id: string | null;
  team_b_id: string | null;
  status: string;
  shots_a: number | null;
  shots_b: number | null;
  winner_team_id: string | null;
};
type KoRow = {
  id: string;
  round: number | null;
  team_a_source: string | null;
  team_b_source: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
  status: string;
  shots_a: number | null;
  shots_b: number | null;
};

function flag(n: string | null): string {
  return n === "brit" ? " 🇬🇧" : n === "kiwi" ? " 🥝" : "";
}

function sourceLabel(s: string | null): string {
  if (!s) return "TBD";
  if (s.startsWith("W:")) return `winner of ${s.slice(2)}`;
  const m = s.match(/^([A-Z])(\d+)$/);
  if (m) {
    const pos = m[2] === "1" ? "winner" : m[2] === "2" ? "runner-up" : `#${m[2]}`;
    return `Group ${m[1]} ${pos}`;
  }
  return s;
}

function projectedSlot(s: string | null): string {
  if (!s) return "—";
  if (s.startsWith("W:")) return `Winner ${s.slice(2)}`;
  return s;
}

function koRoundName(matchCount: number): string {
  const teams = matchCount * 2;
  if (teams === 2) return "Final";
  if (teams === 4) return "Semi-finals";
  if (teams === 8) return "Quarter-finals";
  return `Round of ${teams}`;
}

export default async function SchedulePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: tournament } = await supabase
    .from("tournament")
    .select("id, name, advance")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!tournament) redirect("/");

  const { data: prof } = await supabase
    .from("profile")
    .select("is_owner")
    .eq("id", user.id)
    .maybeSingle();
  const isOwner = !!prof?.is_owner;

  const { data: teamsData } = await supabase
    .from("team")
    .select("id, name, group_label, players:player(display_name, nationality)")
    .eq("tournament_id", tournament.id);
  const teams = (teamsData ?? []) as TeamRow[];

  const { data: fixturesData } = await supabase
    .from("fixture")
    .select(
      "id, stage, group_label, round, rink, order_index, team_a_id, team_b_id, status, shots_a, shots_b, winner_team_id",
    )
    .eq("tournament_id", tournament.id)
    .eq("stage", "group")
    .order("rink", { ascending: true })
    .order("order_index", { ascending: true });
  const fixtures = (fixturesData ?? []) as FixtureRow[];

  const { data: koData } = await supabase
    .from("fixture")
    .select(
      "id, round, team_a_source, team_b_source, team_a_id, team_b_id, status, shots_a, shots_b",
    )
    .eq("tournament_id", tournament.id)
    .eq("stage", "knockout")
    .order("round", { ascending: true })
    .order("order_index", { ascending: true });
  const koFixtures = (koData ?? []) as KoRow[];

  const teamName = (id: string | null): string => {
    const t = teams.find((x) => x.id === id);
    if (!t) return "TBC";
    return t.name ?? t.players.map((p) => p.display_name).join(" & ");
  };

  const completed: Fixture[] = fixtures
    .filter(
      (f) =>
        f.status === "completed" &&
        f.team_a_id &&
        f.team_b_id &&
        f.shots_a != null &&
        f.shots_b != null,
    )
    .map((f) => ({
      id: f.id,
      teamA: f.team_a_id as string,
      teamB: f.team_b_id as string,
      outcome: {
        kind: "played",
        ends: [{ shotsA: f.shots_a as number, shotsB: f.shots_b as number }],
      },
    }));

  const groupLabels = [
    ...new Set(teams.map((t) => t.group_label).filter((l): l is string => !!l)),
  ].sort();
  const rinks = [
    ...new Set(fixtures.map((f) => f.rink).filter((r): r is number => r != null)),
  ].sort((a, b) => a - b);

  // Projected bracket, used only if the real knockout hasn't been created yet.
  const groupSize = new Map<string, number>();
  for (const t of teams) {
    if (t.group_label) {
      groupSize.set(t.group_label, (groupSize.get(t.group_label) ?? 0) + 1);
    }
  }
  const qualifierLabels: string[] = [];
  for (let pos = 1; pos <= tournament.advance; pos++) {
    for (const g of groupLabels) {
      if ((groupSize.get(g) ?? 0) >= pos) qualifierLabels.push(`${g}${pos}`);
    }
  }
  const projected = buildBracket(qualifierLabels);

  const koByRound = new Map<number, KoRow[]>();
  for (const k of koFixtures) {
    const r = k.round ?? 0;
    koByRound.set(r, [...(koByRound.get(r) ?? []), k]);
  }
  const koRounds = [...koByRound.keys()]
    .sort((a, b) => a - b)
    .map((r) => ({ round: r, matches: koByRound.get(r)! }));

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-10">
      <div className="w-full max-w-lg">
        <header className="text-center">
          <Link
            href="/"
            className="text-sm text-foreground/50 hover:text-foreground/80"
          >
            ← home
          </Link>
          <p className="mt-2 text-sm font-medium uppercase tracking-[0.2em] text-brand">
            {tournament.name}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Schedule</h1>
        </header>

        {fixtures.length === 0 ? (
          <p className="mt-6 text-center text-sm text-foreground/60">
            The schedule hasn&apos;t been generated yet.
          </p>
        ) : (
          <div className="mt-6 space-y-6">
            {groupLabels.map((label) => {
              const groupTeamIds = teams
                .filter((t) => t.group_label === label)
                .map((t) => t.id);
              const table = computeStandings(groupTeamIds, completed);
              return (
                <section
                  key={label}
                  className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"
                >
                  <h2 className="text-sm font-semibold">Group {label}</h2>
                  <table className="mt-2 w-full text-sm">
                    <thead>
                      <tr className="text-xs text-foreground/50">
                        <th className="text-left font-medium">Team</th>
                        <th className="w-8 text-center font-medium">P</th>
                        <th className="w-8 text-center font-medium">W</th>
                        <th className="w-10 text-center font-medium">SD</th>
                        <th className="w-8 text-center font-medium">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.map((row) => (
                        <tr
                          key={row.teamId}
                          className={
                            row.rank <= tournament.advance ? "bg-brand/5" : ""
                          }
                        >
                          <td className="py-1">{teamName(row.teamId)}</td>
                          <td className="text-center">{row.played}</td>
                          <td className="text-center">{row.wins}</td>
                          <td className="text-center">
                            {row.shotDiff > 0 ? `+${row.shotDiff}` : row.shotDiff}
                          </td>
                          <td className="text-center font-medium">
                            {row.points}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-xs text-foreground/40">
                    Shaded = qualifying (top {tournament.advance})
                  </p>
                </section>
              );
            })}

            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
              <h2 className="text-sm font-semibold">Knockout draw</h2>
              {koRounds.length > 0 ? (
                <div className="mt-3 space-y-4">
                  {koRounds.map((round) => (
                    <div key={round.round}>
                      <h3 className="text-xs font-semibold text-foreground/60">
                        {koRoundName(round.matches.length)}
                      </h3>
                      <div className="mt-1 space-y-2">
                        {round.matches.map((k) => {
                          const done = k.status === "completed";
                          const slotA = k.team_a_id
                            ? teamName(k.team_a_id)
                            : `TBA · ${sourceLabel(k.team_a_source)}`;
                          const slotB = k.team_b_id
                            ? teamName(k.team_b_id)
                            : `TBA · ${sourceLabel(k.team_b_source)}`;
                          const inner = (
                            <div className="rounded-lg border border-black/10 p-2 text-sm">
                              <div className="flex items-center justify-between">
                                <span>{slotA}</span>
                                {done && (
                                  <span className="font-semibold">
                                    {k.shots_a}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center justify-between">
                                <span>{slotB}</span>
                                {done && (
                                  <span className="font-semibold">
                                    {k.shots_b}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                          return k.status === "pending" ? (
                            <div key={k.id}>{inner}</div>
                          ) : (
                            <Link
                              key={k.id}
                              href={`/fixture/${k.id}`}
                              className="block hover:opacity-70"
                            >
                              {inner}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : projected.length > 0 ? (
                <>
                  <p className="mt-1 text-xs text-foreground/50">
                    Projected — real teams lock in as the groups finish
                    {isOwner ? " (tap refresh below)" : ""}.
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <div className="flex gap-4">
                      {projected.map((round) => (
                        <div
                          key={round.name}
                          className="flex min-w-[9rem] flex-col justify-around gap-3"
                        >
                          <h3 className="text-center text-xs font-semibold text-foreground/60">
                            {round.name}
                          </h3>
                          {round.matches.map((m) => (
                            <div
                              key={m.id}
                              className="rounded-lg border border-black/10 p-2 text-xs"
                            >
                              <div className="truncate">
                                {projectedSlot(m.a)}
                              </div>
                              <div className="my-0.5 text-center text-foreground/30">
                                v
                              </div>
                              <div className="truncate">
                                {projectedSlot(m.b)}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-1 text-xs text-foreground/50">
                  No knockout — the group winner is the champion.
                </p>
              )}

              {isOwner && (
                <form action={refreshKnockout} className="mt-3">
                  <button className="text-xs font-medium text-brand hover:text-brand-dark">
                    Refresh knockout
                  </button>
                </form>
              )}
            </section>

            {rinks.map((rink) => (
              <section
                key={rink}
                className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"
              >
                <h2 className="text-sm font-semibold">Rink {rink}</h2>
                <ol className="mt-1 divide-y divide-black/5">
                  {fixtures
                    .filter((f) => f.rink === rink)
                    .map((f) => {
                      const done = f.status === "completed";
                      return (
                        <li key={f.id}>
                          <Link
                            href={`/fixture/${f.id}`}
                            className="flex items-center justify-between gap-2 py-2 text-sm hover:opacity-70"
                          >
                            <span>
                              {teamName(f.team_a_id)}{" "}
                              <span className="font-medium text-foreground/50">
                                {done ? `${f.shots_a}–${f.shots_b}` : "v"}
                              </span>{" "}
                              {teamName(f.team_b_id)}
                            </span>
                            <span className="shrink-0 text-xs text-foreground/50">
                              {done
                                ? "✓ done"
                                : `Grp ${f.group_label} · R${f.round}`}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
