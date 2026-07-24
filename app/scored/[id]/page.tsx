import Link from "next/link";
import { HomeButton } from "../../_components/home-button";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type TeamLite = { id: string; name: string | null; players: { display_name: string }[] };

export default async function ScoredPage({
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

  const admin = createAdminClient();
  const [{ data: fixture }, { data: tournament }] = await Promise.all([
    admin
      .from("fixture")
      .select("shots_a, shots_b, team_a_id, team_b_id")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("tournament")
      .select("voting_status")
      .neq("status", "archived")
      .limit(1)
      .maybeSingle(),
  ]);

  const votingOpen = tournament?.voting_status === "open";

  let aName = "Team A";
  let bName = "Team B";
  if (fixture) {
    const ids = [fixture.team_a_id, fixture.team_b_id].filter(Boolean) as string[];
    const { data: teams } = await admin
      .from("team")
      .select("id, name, players:player(display_name)")
      .in("id", ids);
    const label = (tid: string | null) => {
      const t = ((teams ?? []) as TeamLite[]).find((x) => x.id === tid);
      return t ? (t.name ?? t.players.map((p) => p.display_name).join(" & ")) : "—";
    };
    aName = label(fixture.team_a_id);
    bName = label(fixture.team_b_id);
  }

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-12">
      <div className="w-full max-w-md text-center">
        <p className="text-5xl">🎳</p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Score saved!</h1>
        {fixture && fixture.shots_a != null && fixture.shots_b != null && (
          <p className="mt-1 text-sm text-foreground/60">
            {aName} {fixture.shots_a}–{fixture.shots_b} {bName}
          </p>
        )}

        {votingOpen && (
          <div className="mt-6 rounded-2xl bg-brand/10 p-5 ring-1 ring-brand/30">
            <p className="text-3xl">🎯</p>
            <p className="mt-1 font-semibold">While it&apos;s fresh…</p>
            <p className="mt-1 text-sm text-foreground/70">
              See a cracking bowl that game? Vote for Bowl of the Day now — you
              can always change it later.
            </p>
            <Link
              href="/awards#bowl_of_the_day"
              className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Vote for Bowl of the Day →
            </Link>
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-2">
          <HomeButton />
          <Link
            href="/schedule"
            className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium hover:bg-black/[.03]"
          >
            See the schedule
          </Link>
        </div>
      </div>
    </main>
  );
}
