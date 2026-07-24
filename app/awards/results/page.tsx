import Link from "next/link";
import { HomeButton } from "../../_components/home-button";
import { SBMark } from "../../_components/sb-mark";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AWARDS, type AwardDef } from "@/lib/domain/awards";

type PlayerRow = { id: string; display_name: string; nationality: string | null };
type TeamRow = { id: string; name: string | null; players: { display_name: string }[] };

function flag(n: string | null): string {
  return n === "brit" ? "🇬🇧 " : n === "kiwi" ? "🇳🇿 " : "";
}

export default async function ResultsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const admin = createAdminClient();
  const { data: tournament } = await admin
    .from("tournament")
    .select("id, voting_status")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!tournament) redirect("/awards");

  const status = tournament.voting_status as "pending" | "open" | "closed";

  const [{ data: playersData }, { data: teamsData }, { data: allVotes }] =
    await Promise.all([
      admin
        .from("player")
        .select("id, display_name, nationality")
        .eq("tournament_id", tournament.id),
      admin
        .from("team")
        .select("id, name, players:player(display_name)")
        .eq("tournament_id", tournament.id),
      admin
        .from("award_vote")
        .select("award_key, target_id")
        .eq("tournament_id", tournament.id),
    ]);

  const players = (playersData ?? []) as PlayerRow[];
  const teams = (teamsData ?? []) as TeamRow[];
  const teamLabel = (t: TeamRow) =>
    t.name ?? t.players.map((p) => p.display_name).join(" & ");

  const tally = new Map<string, Map<string, number>>();
  for (const v of allVotes ?? []) {
    const m = tally.get(v.award_key) ?? new Map<string, number>();
    m.set(v.target_id, (m.get(v.target_id) ?? 0) + 1);
    tally.set(v.award_key, m);
  }
  const countOf = (key: string, id: string) => tally.get(key)?.get(id) ?? 0;

  const standings = (award: AwardDef) => {
    const cand =
      award.kind === "team"
        ? teams.map((t) => ({
            label: teamLabel(t),
            count: countOf(award.key, t.id),
          }))
        : players
            .filter(
              (p) => !award.nationality || p.nationality === award.nationality,
            )
            .map((p) => ({
              label: `${flag(p.nationality)}${p.display_name}`,
              count: countOf(award.key, p.id),
            }));
    return cand.filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
  };

  const totalVotes = (allVotes ?? []).length;

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-10">
      <div className="w-full max-w-md">
        <header>
          <div className="flex items-center justify-between">
            <HomeButton />
            <Link
              href="/awards"
              className="text-sm font-medium text-brand hover:text-brand-dark"
            >
              Voting →
            </Link>
          </div>
          <h1 className="mt-3 text-center font-display text-2xl font-semibold tracking-tight">
            <SBMark className="mr-1.5" />📊 Live results
          </h1>
          <p className="mt-1 text-sm text-foreground/60">
            {status === "closed"
              ? "Final tallies."
              : status === "open"
                ? "Updating as votes come in · reload to refresh."
                : "Voting hasn't opened yet."}
            {totalVotes > 0 && ` · ${totalVotes} vote${totalVotes === 1 ? "" : "s"} so far`}
          </p>
        </header>

        <div className="mt-6 space-y-3">
          {AWARDS.map((award) => {
            const rows = standings(award);
            const max = rows[0]?.count ?? 0;
            return (
              <section
                key={award.key}
                className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
              >
                <h3 className="text-lg font-semibold">
                  {award.emoji} {award.title}
                </h3>
                {rows.length === 0 ? (
                  <p className="mt-1 text-sm text-foreground/50">No votes yet.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {rows.map((r, i) => (
                      <div key={r.label}>
                        <div className="flex justify-between text-sm">
                          <span className={i === 0 ? "font-semibold" : ""}>
                            {i === 0 ? "🏆 " : ""}
                            {r.label}
                          </span>
                          <span className="tabular-nums text-foreground/60">
                            {r.count}
                          </span>
                        </div>
                        <div className="mt-0.5 h-2 rounded-full bg-black/5">
                          <div
                            className="h-2 rounded-full bg-brand"
                            style={{ width: `${max ? (r.count / max) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
