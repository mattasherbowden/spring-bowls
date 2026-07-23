import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeStandings } from "@/lib/domain/standings";
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

function flag(n: string | null): string {
  return n === "brit" ? " 🇬🇧" : n === "kiwi" ? " 🥝" : "";
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

  const { data: teamsData } = await supabase
    .from("team")
    .select("id, name, group_label, players:player(display_name, nationality)")
    .eq("tournament_id", tournament.id);
  const teams = (teamsData ?? []) as TeamRow[];

  const { data: fixturesData } = await supabase
    .from("fixture")
    .select(
      "id, group_label, round, rink, order_index, team_a_id, team_b_id, status, shots_a, shots_b, winner_team_id",
    )
    .eq("tournament_id", tournament.id)
    .order("rink", { ascending: true })
    .order("order_index", { ascending: true });
  const fixtures = (fixturesData ?? []) as FixtureRow[];

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
                          className={row.rank <= tournament.advance ? "bg-brand/5" : ""}
                        >
                          <td className="py-1">{teamName(row.teamId)}</td>
                          <td className="text-center">{row.played}</td>
                          <td className="text-center">{row.wins}</td>
                          <td className="text-center">
                            {row.shotDiff > 0 ? `+${row.shotDiff}` : row.shotDiff}
                          </td>
                          <td className="text-center font-medium">{row.points}</td>
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
                              {done ? "✓ done" : `Grp ${f.group_label} · R${f.round}`}
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
