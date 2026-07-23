import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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
    .select("id, name")
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
    .select("id, group_label, round, rink, order_index, team_a_id, team_b_id")
    .eq("tournament_id", tournament.id)
    .order("rink", { ascending: true })
    .order("order_index", { ascending: true });
  const fixtures = (fixturesData ?? []) as FixtureRow[];

  const teamName = (id: string | null): string => {
    const t = teams.find((x) => x.id === id);
    if (!t) return "TBC";
    return t.name ?? t.players.map((p) => p.display_name).join(" & ");
  };

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
            <section className="grid grid-cols-2 gap-3">
              {groupLabels.map((label) => (
                <div
                  key={label}
                  className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"
                >
                  <h2 className="text-sm font-semibold">Group {label}</h2>
                  <ul className="mt-2 space-y-1 text-sm text-foreground/70">
                    {teams
                      .filter((t) => t.group_label === label)
                      .map((t) => (
                        <li key={t.id}>
                          {t.name ??
                            t.players
                              .map((p) => `${p.display_name}${flag(p.nationality)}`)
                              .join(" & ")}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </section>

            {rinks.map((rink) => (
              <section
                key={rink}
                className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"
              >
                <h2 className="text-sm font-semibold">Rink {rink}</h2>
                <ol className="mt-2 space-y-2">
                  {fixtures
                    .filter((f) => f.rink === rink)
                    .map((f) => (
                      <li
                        key={f.id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span>
                          {teamName(f.team_a_id)}{" "}
                          <span className="text-foreground/40">v</span>{" "}
                          {teamName(f.team_b_id)}
                        </span>
                        <span className="shrink-0 text-xs text-foreground/50">
                          Grp {f.group_label} · R{f.round}
                        </span>
                      </li>
                    ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
