import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TeamBuilder } from "./_builder";

export default async function TeamsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("profile")
    .select("is_owner")
    .eq("id", user.id)
    .single();
  if (!profile?.is_owner) redirect("/");

  const { data: tournament } = await supabase
    .from("tournament")
    .select("id, name, team_size, planned_teams")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!tournament) redirect("/setup");

  const { data: teams } = await supabase
    .from("team")
    .select("id, name, players:player(display_name, nationality)")
    .eq("tournament_id", tournament.id)
    .order("created_at", { ascending: true });

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
            teamSize={tournament.team_size}
            plannedTeams={tournament.planned_teams}
            teams={teams ?? []}
          />
        </div>
      </div>
    </main>
  );
}
