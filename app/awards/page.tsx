import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AWARDS, type AwardDef } from "@/lib/domain/awards";
import { isOrganiserNominee } from "@/lib/domain/voting";
import { AwardCard } from "./_card";
import { VotingStatusButton } from "./_status-button";
import { HomeButton } from "../_components/home-button";
import { SBMark } from "../_components/sb-mark";

type PlayerRow = {
  id: string;
  profile_id: string;
  display_name: string;
  nationality: string | null;
  team_id: string | null;
};
type TeamRow = { id: string; name: string | null; players: { display_name: string }[] };
type ProfileRow = { id: string; is_owner: boolean; is_admin: boolean };

function flag(nat: string | null): string {
  return nat === "brit" ? "🇬🇧 " : nat === "kiwi" ? "🇳🇿 " : "";
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center px-5 py-10">
      <div className="w-full max-w-md">
        <header>
          <div className="flex items-center justify-between">
            <HomeButton />
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              <SBMark className="mr-1.5" />🏆 Awards
            </h1>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

export default async function AwardsPage() {
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

  const { data: prof } = await admin
    .from("profile")
    .select("is_owner, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  const canManage = !!prof?.is_owner || !!prof?.is_admin;

  if (!tournament) {
    return (
      <Frame>
        <p className="mt-8 text-center text-sm text-foreground/60">
          Awards voting opens once a tournament is set up.
        </p>
      </Frame>
    );
  }

  const status = tournament.voting_status as "pending" | "open" | "closed";

  const [
    { data: playersData },
    { data: teamsData },
    { data: allVotes },
    { data: myVotes },
    { data: koData },
    { data: organiserProfilesData },
  ] = await Promise.all([
    admin
      .from("player")
      .select("id, profile_id, display_name, nationality, team_id")
      .eq("tournament_id", tournament.id),
    admin
      .from("team")
      .select("id, name, players:player(display_name)")
      .eq("tournament_id", tournament.id),
    admin
      .from("award_vote")
      .select("award_key, target_id")
      .eq("tournament_id", tournament.id),
    admin
      .from("award_vote")
      .select("award_key, target_id")
      .eq("tournament_id", tournament.id)
      .eq("voter_id", user.id),
    admin
      .from("fixture")
      .select("round, status, winner_team_id")
      .eq("tournament_id", tournament.id)
      .eq("stage", "knockout"),
    admin
      .from("profile")
      .select("id, is_owner, is_admin")
      .or("is_owner.eq.true,is_admin.eq.true"),
  ]);

  const players = (playersData ?? []) as PlayerRow[];
  const teams = (teamsData ?? []) as TeamRow[];
  const organiserProfiles = new Map(
    ((organiserProfilesData ?? []) as ProfileRow[]).map((profile) => [
      profile.id,
      profile,
    ]),
  );
  const teamLabel = (t: TeamRow) =>
    t.name ?? t.players.map((p) => p.display_name).join(" & ");
  const teamLabelById = (id: string) => {
    const t = teams.find((x) => x.id === id);
    return t ? teamLabel(t) : "—";
  };

  const voter = players.find((p) => p.profile_id === user.id);
  const voterPlayerId = voter?.id ?? null;
  const voterTeamId = voter?.team_id ?? null;

  // Tally: award_key -> target_id -> count.
  const tally = new Map<string, Map<string, number>>();
  for (const v of allVotes ?? []) {
    const m = tally.get(v.award_key) ?? new Map<string, number>();
    m.set(v.target_id, (m.get(v.target_id) ?? 0) + 1);
    tally.set(v.award_key, m);
  }
  const countOf = (key: string, id: string) => tally.get(key)?.get(id) ?? 0;

  // The voter's own picks per award.
  const myPicks = new Map<string, string[]>();
  for (const v of myVotes ?? []) {
    const arr = myPicks.get(v.award_key) ?? [];
    arr.push(v.target_id);
    myPicks.set(v.award_key, arr);
  }

  // Nominees for VOTING exclude the voter's own team/self. Organisers remain
  // visible for individual awards but are marked as deliberately unselectable.
  const nomineesFor = (award: AwardDef) => {
    if (award.kind === "team") {
      return teams
        .filter((t) => t.id !== voterTeamId)
        .map((t) => ({
          id: t.id,
          label: teamLabel(t),
          count: countOf(award.key, t.id),
        }));
    }
    return players
      .filter((p) => p.id !== voterPlayerId)
      .filter((p) => !award.nationality || p.nationality === award.nationality)
      .map((p) => ({
        id: p.id,
        label: `${flag(p.nationality)}${p.display_name}`,
        count: countOf(award.key, p.id),
        organiser: isOrganiserNominee(organiserProfiles.get(p.profile_id)),
      }));
  };

  // Results for the CEREMONY include everyone (you can win your own award).
  const resultFor = (award: AwardDef) => {
    const candidates =
      award.kind === "team"
        ? teams.map((t) => ({
            id: t.id,
            label: teamLabel(t),
            count: countOf(award.key, t.id),
          }))
        : players
            .filter(
              (p) => !award.nationality || p.nationality === award.nationality,
            )
            .map((p) => ({
              id: p.id,
              label: `${flag(p.nationality)}${p.display_name}`,
              count: countOf(award.key, p.id),
            }));
    const max = candidates.reduce((m, c) => Math.max(m, c.count), 0);
    return { winners: max > 0 ? candidates.filter((c) => c.count === max) : [], max };
  };

  // Champion = winner of the last completed knockout round.
  const ko = koData ?? [];
  const maxRound = ko.reduce((m, f) => Math.max(m, f.round ?? 0), 0);
  const finalFx = ko.find(
    (f) =>
      f.round === maxRound &&
      (f.status === "completed" || f.status === "walkover") &&
      f.winner_team_id,
  );
  const champion = finalFx?.winner_team_id
    ? teamLabelById(finalFx.winner_team_id)
    : null;

  const adminBar = canManage && (
    <div className="mt-6 rounded-xl bg-white p-4 text-sm shadow-sm ring-1 ring-black/5">
      <p className="font-medium">
        Voting is{" "}
        <span className="text-brand-dark">
          {status === "open" ? "open" : status === "closed" ? "closed" : "not open yet"}
        </span>{" "}
        <span className="text-xs text-foreground/50">(you control this)</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {status !== "open" && (
          <VotingStatusButton to="open" label="Open voting" />
        )}
        {status === "open" && (
          <VotingStatusButton
            to="closed"
            label="Close voting & reveal winners"
          />
        )}
        {status === "closed" && (
          <VotingStatusButton to="open" label="Re-open voting" />
        )}
      </div>
    </div>
  );

  if (status === "closed") {
    return (
      <Frame>
        {adminBar}
        <p className="mt-6 text-center text-sm text-foreground/60">
          🎉 That&apos;s a wrap — here are your winners.
        </p>
        <div className="mt-2 text-center">
          <Link
            href="/awards/results"
            className="text-sm font-medium text-brand hover:text-brand-dark"
          >
            📊 See the full tally →
          </Link>
        </div>
        {champion && (
          <section className="mt-4 rounded-2xl bg-brand/10 p-5 text-center ring-1 ring-brand/30">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-dark">
              🏆 Grand Final Winner
            </p>
            <p className="mt-1 text-2xl font-bold">{champion}</p>
          </section>
        )}
        <div className="mt-4 space-y-3">
          {AWARDS.map((award) => {
            const { winners, max } = resultFor(award);
            return (
              <section
                key={award.key}
                className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
              >
                <h3
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-base font-semibold"
                  style={{ backgroundColor: award.tint, color: award.ink }}
                >
                  {award.emoji} {award.title}
                </h3>
                {winners.length === 0 ? (
                  <p className="mt-1 text-sm text-foreground/50">
                    No votes cast.
                  </p>
                ) : (
                  <p className="mt-1">
                    {winners.map((w) => (
                      <span key={w.id} className="font-medium">
                        {w.label}
                        {winners.length > 1 ? " " : ""}
                      </span>
                    ))}
                    <span className="text-sm text-foreground/50">
                      {" "}
                      · {max} vote{max === 1 ? "" : "s"}
                      {winners.length > 1 ? " (tie)" : ""}
                    </span>
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </Frame>
    );
  }

  if (status === "pending") {
    return (
      <Frame>
        {adminBar}
        <div className="mt-8 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
          <p className="text-4xl">🗳️</p>
          <p className="mt-2 font-medium">Voting hasn&apos;t opened yet</p>
          <p className="mt-1 text-sm text-foreground/60">
            Check back later — most awards give you two votes; Bowl of the Day
            gives you five.
          </p>
        </div>
      </Frame>
    );
  }

  // status === "open"
  return (
    <Frame>
      {adminBar}
      <p className="mt-6 text-sm text-foreground/60">
        Two votes for most awards and five for Bowl of the Day, each to a
        different nominee. You can change them until voting closes. You
        can&apos;t vote for yourself, your own team, or an organiser for an
        individual award.
      </p>
      <Link
        href="/awards/results"
        className="mt-3 inline-block text-sm font-medium text-brand hover:text-brand-dark"
      >
        📊 See live results →
      </Link>
      <div className="mt-4 space-y-3">
        {AWARDS.map((award) => (
          <AwardCard
            key={award.key}
            award={award}
            nominees={nomineesFor(award)}
            picks={myPicks.get(award.key) ?? []}
          />
        ))}
      </div>
    </Frame>
  );
}
