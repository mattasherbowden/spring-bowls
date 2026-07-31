import { redirect } from "next/navigation";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { TeamBuilder } from "./_builder";
import { GenerateScheduleButton } from "./_generate";
import { ResetButton } from "./_reset";
import { EditPreviewButton } from "./_edit-preview";
import { RinkSettings } from "./_rink-settings";
import {
  throwIfAuthUnavailable,
  throwIfSupabaseError,
} from "@/lib/supabase/query-error";
import { formatFixtureOpenTime, isPlayOpen } from "@/lib/domain/play-state";
import { StartTournamentButton } from "../../_components/start-tournament-button";

export default async function TeamsPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  throwIfAuthUnavailable(authError, "team setup authentication");
  if (!user) redirect("/");

  const { data: profile, error: profileError } = await supabase
    .from("profile")
    .select("is_owner")
    .eq("id", user.id)
    .single();
  throwIfSupabaseError(profileError, "team setup profile");
  if (!profile?.is_owner) redirect("/");

  const { data: tournament, error: tournamentError } = await supabase
    .from("tournament")
    .select(
      "id, name, team_size, planned_teams, rink_count, status, play_status, voting_status, fixtures_open_time",
    )
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(tournamentError, "team setup tournament");
  if (!tournament) redirect("/setup");

  const { data: teams, error: teamsError } = await supabase
    .from("team")
    .select("id, name, players:player(id, display_name, nationality)")
    .eq("tournament_id", tournament.id)
    .order("created_at", { ascending: true });
  throwIfSupabaseError(teamsError, "team setup roster");

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
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Teams &amp; logins
          </h1>
          <p className="mt-2 text-sm text-foreground/60">
            Add each team of {tournament.team_size}. Logins are generated — save
            them to hand out.
          </p>
        </header>

        <div className="mt-6">
          <TeamBuilder
            tournamentId={tournament.id}
            submissionKey={randomUUID()}
            teamSize={tournament.team_size}
            plannedTeams={tournament.planned_teams}
            teams={teams ?? []}
            rosterLocked={tournament.status !== "setup"}
            teamEditingAllowed={
              tournament.status === "setup" ||
              (tournament.status === "live" &&
                !isPlayOpen(tournament.play_status) &&
                tournament.voting_status === "pending")
            }
          />
        </div>

        <div className="mt-5">
          {tournament.status === "setup" ? (
            <div className="space-y-3">
              <section className="rounded-2xl bg-amber-50 p-4 text-center ring-1 ring-amber-200">
                <p className="font-semibold text-amber-950">
                  Draw setup is open
                </p>
                <p className="mt-1 text-xs text-amber-900/75">
                  Roster and rink changes are allowed here. Existing logins and
                  passwords stay unchanged; players will see an updating
                  message until you publish the preview.
                </p>
              </section>
              <RinkSettings
                tournamentId={tournament.id}
                rinkCount={tournament.rink_count}
              />
              <GenerateScheduleButton ready={(teams?.length ?? 0) >= 2} />
            </div>
          ) : (
            <div className="space-y-3">
              {!isPlayOpen(tournament.play_status) && (
                <section className="rounded-2xl bg-brand/10 p-4 text-center ring-1 ring-brand/25">
                  <p className="font-semibold text-brand-dark">
                    Preview is ready to share
                  </p>
                  <p className="mt-1 text-xs text-foreground/60">
                    {teams?.length ?? 0}{" "}
                    {tournament.team_size === 2 ? "pairs" : "teams"} ·{" "}
                    {tournament.rink_count} rink
                    {tournament.rink_count === 1 ? "" : "s"}. Players can see
                    the draw, but scores and voting are locked. Their pages say
                    fixtures go live at{" "}
                    {formatFixtureOpenTime(tournament.fixtures_open_time)}.
                  </p>
                  <div className="mt-3">
                    <StartTournamentButton />
                  </div>
                  <div className="mt-2">
                    <EditPreviewButton tournamentId={tournament.id} />
                  </div>
                </section>
              )}
              <Link
                href="/schedule"
                className="block w-full rounded-lg bg-brand px-4 py-3 text-center text-base font-semibold text-white hover:bg-brand-dark"
              >
                View the schedule
              </Link>
            </div>
          )}
        </div>

        <div className="mt-8 border-t border-black/5 pt-5">
          <ResetButton
            live={tournament.status !== "setup"}
            tournamentId={tournament.id}
          />
        </div>
      </div>
    </main>
  );
}
