import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./_components/login-form";
import { CreateOwnerForm } from "./_components/create-owner-form";
import { Countdown } from "./_components/countdown";
import { logout } from "./actions";
import { computeStandings } from "@/lib/domain/standings";
import type { Fixture } from "@/lib/domain/types";

type TeamLite = { id: string; name: string | null; players: { display_name: string }[] };
type FixtureLite = {
  id: string;
  stage: string;
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

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

type EventInfoData = {
  event_at: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_phone: string | null;
  details: string | null;
};

function formatEventDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

function EventInfo({ ev }: { ev: EventInfoData }) {
  const hasVenue = ev.venue_name || ev.venue_address || ev.venue_phone;
  const mapQuery = encodeURIComponent(
    `${ev.venue_name ?? ""} ${ev.venue_address ?? ""}`.trim(),
  );
  return (
    <>
      {ev.details && (
        <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-lg font-semibold">On the day</h2>
          <div className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground/80">
            {ev.details}
          </div>
        </section>
      )}
      {hasVenue && (
        <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-lg font-semibold">📍 Venue</h2>
          {ev.venue_name && <p className="mt-2 font-medium">{ev.venue_name}</p>}
          {ev.venue_address && (
            <a
              href={`https://maps.google.com/?q=${mapQuery}`}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block text-sm text-brand hover:text-brand-dark"
            >
              {ev.venue_address}
            </a>
          )}
          {ev.venue_phone && (
            <a
              href={`tel:${ev.venue_phone.replace(/\s+/g, "")}`}
              className="mt-1 block text-sm text-foreground/60"
            >
              {ev.venue_phone}
            </a>
          )}
        </section>
      )}
    </>
  );
}

function Shell({
  children,
  dateLabel,
}: {
  children: ReactNode;
  dateLabel: string;
}) {
  return (
    <main className="flex flex-1 flex-col items-center px-5 py-10">
      <div className="w-full max-w-md">
        <header className="text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-brand">
            7th edition
          </p>
          <h1 className="mt-2 text-5xl font-bold tracking-tight">
            Spring <span className="text-brand">Bowls</span>
          </h1>
          <div className="mt-4 flex justify-center">
            <span className="rounded-full bg-white px-3 py-1 text-sm font-medium shadow-sm ring-1 ring-black/5">
              🇬🇧 BYO Brit edition 🥝
            </span>
          </div>
          <p className="mt-4 text-base text-foreground/70">{dateLabel}</p>
        </header>
        {children}
      </div>
    </main>
  );
}

function LogoutButton() {
  return (
    <form action={logout} className="mt-5">
      <button className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium hover:bg-black/[.03]">
        Log out
      </button>
    </form>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: evData } = await supabase
    .from("event_settings")
    .select("event_at, venue_name, venue_address, venue_phone, details")
    .eq("id", 1)
    .maybeSingle();
  const ev = evData as EventInfoData | null;
  const dateLabel = ev?.event_at
    ? formatEventDate(ev.event_at)
    : "date to be confirmed";

  if (!user) {
    const { data: setupDone } = await supabase.rpc("owner_exists");
    return (
      <Shell dateLabel={dateLabel}>
        {ev?.event_at && (
          <section className="mt-8 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-center text-xs font-semibold uppercase tracking-wide text-foreground/50">
              Bowls begins in
            </p>
            <div className="mt-3">
              <Countdown target={ev.event_at} />
            </div>
          </section>
        )}
        <section
          className={`${ev?.event_at ? "mt-4" : "mt-8"} rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5`}
        >
          {setupDone ? (
            <>
              <h2 className="text-lg font-semibold">Log in</h2>
              <p className="mt-1 text-sm text-foreground/60">
                Use the username and password from your card.
              </p>
              <LoginForm />
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Set up your account</h2>
              <p className="mt-1 text-sm text-foreground/60">
                You are first here — create the host (owner) account.
              </p>
              <CreateOwnerForm />
            </>
          )}
        </section>
        {setupDone && ev && <EventInfo ev={ev} />}
        <p className="mt-6 text-center text-xs text-foreground/50">
          See you on the green.
        </p>
      </Shell>
    );
  }

  const { data: profile } = await supabase
    .from("profile")
    .select("display_name, is_owner, is_admin")
    .eq("id", user.id)
    .single();
  const { data: tournament } = await supabase
    .from("tournament")
    .select("id, name, advance, status")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();

  let teamId: string | null = null;
  if (tournament) {
    const { data } = await supabase
      .from("player")
      .select("team_id")
      .eq("tournament_id", tournament.id)
      .eq("profile_id", user.id)
      .maybeSingle();
    teamId = data?.team_id ?? null;
  }

  const firstName = profile?.display_name?.split(" ")[0] ?? "there";

  if (tournament && teamId) {
    return (
      <Shell dateLabel={dateLabel}>
        <PlayerHome
          tournamentId={tournament.id}
          advance={tournament.advance}
          teamId={teamId}
          firstName={firstName}
          event={ev}
        />
        <LogoutButton />
      </Shell>
    );
  }

  return (
    <Shell dateLabel={dateLabel}>
      <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
        <h2 className="text-lg font-semibold">
          Welcome, {firstName}
          {profile?.is_owner ? (
            <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-dark">
              owner
            </span>
          ) : profile?.is_admin ? (
            <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-dark">
              helper
            </span>
          ) : null}
        </h2>
        {profile?.is_owner ? (
          tournament ? (
            <div className="mt-4">
              <p className="text-sm text-foreground/70">
                <span className="font-medium">{tournament.name}</span> ·{" "}
                {tournament.status === "setup" ? "setting up" : "live"}
              </p>
              <p className="mt-1 text-xs text-foreground/50">
                {tournament.status === "setup"
                  ? "Next: add your teams & logins, then generate the schedule."
                  : "It's live — players can log in and enter their scores."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/setup/teams"
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
                >
                  Teams &amp; logins
                </Link>
                <Link
                  href="/schedule"
                  className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium hover:bg-black/[.03]"
                >
                  Schedule &amp; overview
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-sm text-foreground/70">
                No tournament yet — start by choosing the format.
              </p>
              <Link
                href="/setup"
                className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                Create a tournament
              </Link>
            </div>
          )
        ) : profile?.is_admin ? (
          <div className="mt-4">
            <p className="text-sm text-foreground/70">
              You&apos;re a helper — you can enter or fix any game&apos;s score.
            </p>
            <p className="mt-1 text-xs text-foreground/50">
              Open the schedule, tap a game, then enter or reset its score.
            </p>
            <Link
              href="/schedule"
              className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Schedule &amp; fix scores
            </Link>
          </div>
        ) : (
          <p className="mt-4 text-sm text-foreground/70">
            Your games will appear here once the tournament starts.
          </p>
        )}
        {profile?.is_owner && (
          <div className="mt-4 flex flex-col items-start gap-1.5">
            <Link
              href="/setup/event"
              className="text-sm font-medium text-brand hover:text-brand-dark"
            >
              Edit event details →
            </Link>
            <Link
              href="/setup/helpers"
              className="text-sm font-medium text-brand hover:text-brand-dark"
            >
              Manage helpers →
            </Link>
            <Link
              href="/setup/owner"
              className="text-sm font-medium text-brand hover:text-brand-dark"
            >
              Account &amp; recovery →
            </Link>
          </div>
        )}
      </section>
    </Shell>
  );
}

async function PlayerHome({
  tournamentId,
  advance,
  teamId,
  firstName,
  event,
}: {
  tournamentId: string;
  advance: number;
  teamId: string;
  firstName: string;
  event: EventInfoData | null;
}) {
  const supabase = await createClient();

  const { data: myTeam } = await supabase
    .from("team")
    .select("id, name, group_label, players:player(display_name)")
    .eq("id", teamId)
    .single();
  const groupLabel: string | null = myTeam?.group_label ?? null;

  const { data: groupTeamsData } = await supabase
    .from("team")
    .select("id, name, players:player(display_name)")
    .eq("tournament_id", tournamentId)
    .eq("group_label", groupLabel ?? "__none__");
  const groupTeams = (groupTeamsData ?? []) as TeamLite[];

  const { data: myFixturesData } = await supabase
    .from("fixture")
    .select(
      "id, stage, round, rink, order_index, team_a_id, team_b_id, status, shots_a, shots_b, winner_team_id",
    )
    .eq("tournament_id", tournamentId)
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .order("order_index", { ascending: true });
  const myFixtures = (myFixturesData ?? []) as FixtureLite[];

  const { data: groupFixturesData } = await supabase
    .from("fixture")
    .select("team_a_id, team_b_id, status, shots_a, shots_b")
    .eq("tournament_id", tournamentId)
    .eq("group_label", groupLabel ?? "__none__");

  const nameById = new Map<string, string>();
  const add = (t: TeamLite) =>
    nameById.set(t.id, t.name ?? t.players.map((p) => p.display_name).join(" & "));
  if (myTeam) add(myTeam as TeamLite);
  groupTeams.forEach(add);
  // Knockout opponents can be from other groups; fall back to "TBC".
  const nameOf = (id: string | null) => (id ? (nameById.get(id) ?? "TBC") : "TBC");

  const completed: Fixture[] = (groupFixturesData ?? [])
    .filter(
      (f) =>
        f.status === "completed" &&
        f.team_a_id &&
        f.team_b_id &&
        f.shots_a != null &&
        f.shots_b != null,
    )
    .map((f) => ({
      id: "x",
      teamA: f.team_a_id as string,
      teamB: f.team_b_id as string,
      outcome: {
        kind: "played",
        ends: [{ shotsA: f.shots_a as number, shotsB: f.shots_b as number }],
      },
    }));
  const table = computeStandings(
    groupTeams.map((t) => t.id),
    completed,
  );
  const myRank = table.find((r) => r.teamId === teamId)?.rank ?? null;

  const isDone = (f: FixtureLite) =>
    f.status === "completed" || f.status === "walkover";
  const played = myFixtures.filter(isDone);
  const unplayed = myFixtures.filter((f) => !isDone(f));
  const upNext = unplayed[0];
  const coming = unplayed.slice(1);

  const view = (f: FixtureLite) => {
    const iAmA = f.team_a_id === teamId;
    return {
      oppId: iAmA ? f.team_b_id : f.team_a_id,
      myShots: iAmA ? f.shots_a : f.shots_b,
      oppShots: iAmA ? f.shots_b : f.shots_a,
      won: f.winner_team_id === teamId,
    };
  };

  return (
    <>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Hi {firstName} 👋</h2>
        <p className="text-sm text-foreground/60">
          {nameOf(teamId)} · Group {groupLabel ?? "—"}
        </p>
      </section>

      {upNext ? (
        (() => {
          const v = view(upNext);
          const ready = !!v.oppId;
          const inner = (
            <div className="rounded-2xl bg-brand/10 p-5 ring-1 ring-brand/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-brand-dark">
                  {upNext.stage === "knockout" ? "Knockout · next" : "Up next"}
                </span>
                {upNext.rink && (
                  <span className="text-xs text-foreground/60">
                    Rink {upNext.rink}
                  </span>
                )}
              </div>
              <p className="mt-1 text-2xl font-bold tracking-tight">
                v {nameOf(v.oppId)}
              </p>
              {myRank && (
                <p className="mt-1 text-sm text-foreground/70">
                  You&apos;re currently {ordinal(myRank)} of {table.length} in
                  Group {groupLabel}
                </p>
              )}
              <p className="mt-3 text-sm font-medium text-brand-dark">
                {ready
                  ? "Tap to enter the score →"
                  : "Waiting for your opponent to be decided"}
              </p>
            </div>
          );
          return ready ? (
            <Link className="mt-4 block" href={`/fixture/${upNext.id}`}>
              {inner}
            </Link>
          ) : (
            <div className="mt-4">{inner}</div>
          );
        })()
      ) : (
        <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <p className="text-sm font-medium">
            All your games are done
            {myRank ? ` — ${ordinal(myRank)} in Group ${groupLabel}` : ""}.
          </p>
          <p className="mt-1 text-sm text-foreground/60">
            Sit tight for the knockout and the ceremony.
          </p>
        </div>
      )}

      {coming.length > 0 && (
        <section className="mt-6">
          <h3 className="text-sm font-medium text-foreground/60">Coming up</h3>
          <div className="mt-2 space-y-2">
            {coming.map((f) => {
              const v = view(f);
              return (
                <div
                  key={f.id}
                  className="rounded-2xl bg-white p-4 opacity-60 shadow-sm ring-1 ring-black/5"
                >
                  <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">
                    {f.stage === "knockout" ? "Knockout" : "Group game"}
                    {f.rink ? ` · Rink ${f.rink}` : ""}
                  </span>
                  <p className="mt-1 font-medium">v {nameOf(v.oppId)}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {played.length > 0 && (
        <section className="mt-6">
          <h3 className="text-sm font-medium text-foreground/60">Your results</h3>
          <div className="mt-2 space-y-2">
            {played.map((f) => {
              const v = view(f);
              return (
                <Link
                  key={f.id}
                  href={`/fixture/${f.id}`}
                  className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 hover:opacity-80"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">
                      {f.stage === "knockout" ? "Knockout · " : ""}
                      {v.won ? "Won" : "Lost"}
                      {f.rink ? ` · Rink ${f.rink}` : ""}
                    </span>
                    <span className="text-sm font-semibold">
                      {v.myShots}–{v.oppShots}
                    </span>
                  </div>
                  <p className="mt-1 font-medium">v {nameOf(v.oppId)}</p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <h3 className="text-sm font-semibold">Group {groupLabel ?? "—"}</h3>
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
                  row.teamId === teamId
                    ? "font-semibold text-brand-dark"
                    : row.rank <= advance
                      ? "bg-brand/5"
                      : ""
                }
              >
                <td className="py-1">{nameOf(row.teamId)}</td>
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
      </section>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href="/schedule"
          className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium hover:bg-black/[.03]"
        >
          See the draw
        </Link>
        <button
          disabled
          className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-foreground/40"
        >
          Vote for awards (soon)
        </button>
      </div>

      {event && <EventInfo ev={event} />}
    </>
  );
}
