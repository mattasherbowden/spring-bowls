import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ScoreForm, UnlockButton } from "./_scoreform";

type TeamRow = {
  id: string;
  name: string | null;
  players: { display_name: string }[];
};

export default async function FixturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: fixture } = await supabase
    .from("fixture")
    .select(
      "id, tournament_id, group_label, round, rink, team_a_id, team_b_id, status, shots_a, shots_b, winner_team_id, entered_by",
    )
    .eq("id", id)
    .maybeSingle();
  if (!fixture) redirect("/schedule");

  const ids = [fixture.team_a_id, fixture.team_b_id].filter(
    (x): x is string => !!x,
  );
  const { data: teamsData } = await supabase
    .from("team")
    .select("id, name, players:player(display_name)")
    .in("id", ids);
  const teams = (teamsData ?? []) as TeamRow[];
  const teamName = (tid: string | null): string => {
    const t = teams.find((x) => x.id === tid);
    return t ? (t.name ?? t.players.map((p) => p.display_name).join(" & ")) : "TBC";
  };

  const { data: tournament } = await supabase
    .from("tournament")
    .select("ends_per_game")
    .eq("id", fixture.tournament_id)
    .maybeSingle();

  const { data: me } = await supabase
    .from("player")
    .select("team_id, role")
    .eq("tournament_id", fixture.tournament_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  const { data: prof } = await supabase
    .from("profile")
    .select("is_owner")
    .eq("id", user.id)
    .maybeSingle();

  const isMember =
    !!me && (me.team_id === fixture.team_a_id || me.team_id === fixture.team_b_id);
  const isAdmin = !!prof?.is_owner || me?.role === "admin";
  const done = fixture.status === "completed" || fixture.status === "walkover";
  const bothSet = !!fixture.team_a_id && !!fixture.team_b_id;

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-10">
      <div className="w-full max-w-md">
        <header className="text-center">
          <Link
            href="/schedule"
            className="text-sm text-foreground/50 hover:text-foreground/80"
          >
            ← schedule
          </Link>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-foreground/50">
            Group {fixture.group_label} · Round {fixture.round} · Rink{" "}
            {fixture.rink}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {teamName(fixture.team_a_id)}{" "}
            <span className="text-foreground/40">v</span>{" "}
            {teamName(fixture.team_b_id)}
          </h1>
        </header>

        {done ? (
          <div className="mt-6 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
            <p className="text-4xl font-bold tracking-tight">
              {fixture.shots_a} – {fixture.shots_b}
            </p>
            <p className="mt-2 text-sm font-medium text-brand-dark">
              {teamName(fixture.winner_team_id)} won
            </p>
            {fixture.entered_by && (
              <p className="mt-1 text-xs text-foreground/50">
                Entered by {fixture.entered_by}
              </p>
            )}
            {isAdmin && <UnlockButton fixtureId={fixture.id} />}
          </div>
        ) : !bothSet ? (
          <p className="mt-6 text-center text-sm text-foreground/60">
            This game is waiting for both teams to be decided.
          </p>
        ) : isMember || isAdmin ? (
          <ScoreForm
            fixtureId={fixture.id}
            endsPerGame={tournament?.ends_per_game ?? 2}
            teamAName={teamName(fixture.team_a_id)}
            teamBName={teamName(fixture.team_b_id)}
          />
        ) : (
          <p className="mt-6 text-center text-sm text-foreground/60">
            This game hasn&apos;t been played yet.
          </p>
        )}
      </div>
    </main>
  );
}
