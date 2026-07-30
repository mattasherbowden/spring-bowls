import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./_components/login-form";
import { CreateOwnerForm } from "./_components/create-owner-form";
import { Countdown } from "./_components/countdown";
import { logout } from "./actions";
import { OrganiserLinks } from "./_components/organiser-links";
import { LiveRefresh } from "./_components/live-refresh";
import { upNextInfo } from "@/lib/domain/up-next";
import {
  applyQualificationOverride,
  computeStandings,
  qualificationTieAtCutoff,
} from "@/lib/domain/standings";
import type { Fixture } from "@/lib/domain/types";
import {
  throwIfAuthUnavailable,
  throwIfSupabaseError,
} from "@/lib/supabase/query-error";
import { isBonusBowlOff } from "@/lib/domain/consolation";

type TeamLite = { id: string; name: string | null; players: { display_name: string }[] };
type FixtureLite = {
  id: string;
  stage: string;
  match_code: string | null;
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
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Europe/London",
  })
    .format(d)
    .replace(/\s/g, "")
    .toLowerCase();
  return `${date} · ${time}`;
}

// A mix of British and Kiwi/Aussie greetings — a fresh one each page load.
const GREETINGS = [
  "G'day",
  "Gidday",
  "Kia ora",
  "Chur",
  "Howzit",
  "Sweet as",
  "Alright",
  "Ay up",
  "Now then",
  "Wotcher",
  "Watcha",
  "Hiya",
  "How do",
  "Oi oi",
  "Ello ello",
  "Easy now",
  "Alright mate",
  "G'day mate",
  "Howdy",
  "Oright",
  "Well hello",
  "Yeeew",
];

function randomGreeting(): string {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

// Shown on the "Up next" tile. WAITING = the rink is occupied or one of the
// teams is finishing an earlier game. LIVE = both the rink and teams are clear.
const WAITING_LINES = [
  "Grab a beer — the game before you is still on 🍺",
  "No rush — the rink's still busy. Time for a cheeky pint 🍺",
  "Chill for a bit — there's a game ahead of you still playing 🍺",
  "Sit tight and sip something — you're not up just yet 🍺",
];
const LIVE_LINES = [
  "You're up — get on the green! 🟢",
  "Your game is live — get out there! 🎳",
  "Rink's clear — you're on! 🟢",
  "Go go go — your rink is ready! 🎳",
];
function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function EventInfo({ ev }: { ev: EventInfoData }) {
  const hasVenue = ev.venue_name || ev.venue_address || ev.venue_phone;
  const mapQuery = encodeURIComponent(
    `${ev.venue_name ?? ""} ${ev.venue_address ?? ""}`.trim(),
  );
  // Split the free-text details into blank-line-separated sections so each reads
  // as its own card instead of one pasted-message blob.
  const sections = (ev.details ?? "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      return { title: lines[0].trim(), body: lines.slice(1).join("\n").trim() };
    });
  return (
    <>
      {sections.length > 0 && (
        <section className="mt-6">
          <h2 className="px-1 text-lg font-semibold">On the day</h2>
          <div className="mt-2 grid gap-2">
            {sections.map((s, i) => (
              <div
                key={i}
                className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"
              >
                <h3 className="font-display text-base font-semibold">
                  {s.title}
                </h3>
                {s.body && (
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground/70">
                    {s.body}
                  </p>
                )}
              </div>
            ))}
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
  eventAt,
}: {
  children: ReactNode;
  dateLabel: string;
  eventAt?: string | null;
}) {
  return (
    <main className="flex flex-1 flex-col items-center px-5 py-10">
      <div className="w-full max-w-md">
        <header className="text-center">
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            Spring <span className="text-pink">Bowls</span>
            <span className="align-super text-[0.4em] font-bold text-brand">
              &rsquo;26
            </span>
          </h1>
          <div className="mt-4 flex justify-center">
            <span className="rounded-full bg-white px-3 py-1 text-sm font-medium shadow-sm ring-1 ring-black/5">
              🇬🇧 BYO British Person Edition 🇳🇿
            </span>
          </div>
          <p className="mt-4 text-base text-foreground/70">{dateLabel}</p>
          {eventAt && (
            <div className="mt-4">
              <Countdown target={eventAt} />
            </div>
          )}
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
    error: authError,
  } = await supabase.auth.getUser();
  throwIfAuthUnavailable(authError, "home authentication");

  const { data: evData, error: eventError } = await supabase
    .from("event_settings")
    .select("event_at, venue_name, venue_address, venue_phone, details")
    .eq("id", 1)
    .maybeSingle();
  throwIfSupabaseError(eventError, "event details");
  const ev = evData as EventInfoData | null;
  const dateLabel = ev?.event_at
    ? formatEventDate(ev.event_at)
    : "date to be confirmed";

  if (!user) {
    const { data: setupDone, error: setupError } =
      await supabase.rpc("owner_exists");
    throwIfSupabaseError(setupError, "owner setup check");
    return (
      <Shell dateLabel={dateLabel} eventAt={ev?.event_at}>
        <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
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

  const { data: profile, error: profileError } = await supabase
    .from("profile")
    .select("display_name, is_owner, is_admin")
    .eq("id", user.id)
    .single();
  throwIfSupabaseError(profileError, "current profile");
  const { data: tournament, error: tournamentError } = await supabase
    .from("tournament")
    .select("id, name, advance, status")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(tournamentError, "active tournament");

  let teamId: string | null = null;
  if (tournament) {
    const { data, error } = await supabase
      .from("player")
      .select("team_id")
      .eq("tournament_id", tournament.id)
      .eq("profile_id", user.id)
      .maybeSingle();
    throwIfSupabaseError(error, "current player");
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
          isOwner={!!profile?.is_owner}
          isAdmin={!!profile?.is_admin}
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
            <Link
              href="/awards"
              className="mt-2 block text-sm font-medium text-brand hover:text-brand-dark"
            >
              Awards &amp; voting →
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
              href="/setup/logins"
              className="text-sm font-medium text-brand hover:text-brand-dark"
            >
              Logins &amp; passwords →
            </Link>
            <Link
              href="/setup/event"
              className="text-sm font-medium text-brand hover:text-brand-dark"
            >
              Edit event details →
            </Link>
            <Link
              href="/awards"
              className="text-sm font-medium text-brand hover:text-brand-dark"
            >
              Awards &amp; voting →
            </Link>
            <Link
              href="/setup/helpers"
              className="text-sm font-medium text-brand hover:text-brand-dark"
            >
              Manage helpers →
            </Link>
            <Link
              href="/setup/photo"
              className="text-sm font-medium text-brand hover:text-brand-dark"
            >
              Photo Bomb emails →
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
      <LogoutButton />
    </Shell>
  );
}

async function PlayerHome({
  tournamentId,
  advance,
  teamId,
  firstName,
  isOwner,
  isAdmin,
}: {
  tournamentId: string;
  advance: number;
  teamId: string;
  firstName: string;
  isOwner: boolean;
  isAdmin: boolean;
}) {
  const supabase = await createClient();

  const { data: allTeamsData, error: allTeamsError } = await supabase
    .from("team")
    .select("id, name, group_label, players:player(display_name)")
    .eq("tournament_id", tournamentId);
  throwIfSupabaseError(allTeamsError, "player home teams");
  const allTeams = (allTeamsData ?? []) as (TeamLite & {
    group_label: string | null;
  })[];
  const myTeam = allTeams.find((t) => t.id === teamId) ?? null;
  const groupLabel: string | null = myTeam?.group_label ?? null;
  const groupTeams = groupLabel
    ? allTeams.filter((t) => t.group_label === groupLabel)
    : [];

  const { data: myFixturesData, error: myFixturesError } = await supabase
    .from("fixture")
    .select(
      "id, stage, match_code, round, rink, order_index, team_a_id, team_b_id, status, shots_a, shots_b, winner_team_id",
    )
    .eq("tournament_id", tournamentId)
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .order("order_index", { ascending: true });
  throwIfSupabaseError(myFixturesError, "player fixtures");
  const myFixtures = (myFixturesData ?? []) as FixtureLite[];

  const { data: groupFixturesData, error: groupFixturesError } = await supabase
    .from("fixture")
    .select("team_a_id, team_b_id, status, shots_a, shots_b")
    .eq("tournament_id", tournamentId)
    .eq("group_label", groupLabel ?? "__none__");
  throwIfSupabaseError(groupFixturesError, "group standings");
  const tiebreakResult = groupLabel
    ? await supabase
        .from("qualification_tiebreak")
        .select("ordered_team_ids")
        .eq("tournament_id", tournamentId)
        .eq("group_label", groupLabel)
        .maybeSingle()
    : { data: null, error: null };
  throwIfSupabaseError(tiebreakResult.error, "qualification tiebreak");
  const tiebreakData = tiebreakResult.data;

  // Every game on the board — used to find the game directly ahead of yours on
  // your rink ("you're on after …").
  const { data: allFixturesData, error: allFixturesError } = await supabase
    .from("fixture")
    .select("id, rink, order_index, team_a_id, team_b_id, status")
    .eq("tournament_id", tournamentId);
  throwIfSupabaseError(allFixturesError, "live fixture board");
  const allFixtures = (allFixturesData ?? []) as Array<{
    id: string;
    rink: number | null;
    order_index: number;
    team_a_id: string | null;
    team_b_id: string | null;
    status: string;
  }>;

  const nameById = new Map<string, string>();
  for (const t of allTeams) {
    nameById.set(
      t.id,
      t.name ?? t.players.map((p) => p.display_name).join(" & "),
    );
  }
  const nameOf = (id: string | null) => (id ? (nameById.get(id) ?? "TBC") : "TBC");

  const completed: Fixture[] = (groupFixturesData ?? [])
    .filter(
      (f) =>
        (f.status === "completed" || f.status === "walkover") &&
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
  const rawTable = computeStandings(
    groupTeams.map((t) => t.id),
    completed,
  );
  const expectedGroupGames =
    (groupTeams.length * Math.max(0, groupTeams.length - 1)) / 2;
  const groupFinished =
    expectedGroupGames > 0 && completed.length >= expectedGroupGames;
  const terminalTie = groupFinished
    ? qualificationTieAtCutoff(rawTable, advance)
    : [];
  const override = (tiebreakData?.ordered_team_ids ?? null) as string[] | null;
  const overrideSet = new Set(override ?? []);
  const validOverride =
    terminalTie.length > 0 &&
    override?.length === terminalTie.length &&
    terminalTie.every((standing) => overrideSet.has(standing.teamId));
  const table = validOverride
    ? applyQualificationOverride(rawTable, override)
    : rawTable;
  const unresolvedQualificationTie = terminalTie.length > 0 && !validOverride;
  const myRank = unresolvedQualificationTie
    ? null
    : (table.find((r) => r.teamId === teamId)?.rank ?? null);
  const eliminated =
    groupFinished &&
    !unresolvedQualificationTie &&
    myRank != null &&
    myRank > advance;

  const isDone = (f: FixtureLite) =>
    f.status === "completed" || f.status === "walkover";
  const gameLabel = (f: FixtureLite): string =>
    isBonusBowlOff(f.match_code) ? "Bonus bowl-off" : "Knockout";
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
        <h2 className="font-display text-xl font-semibold">
          {randomGreeting()}, {firstName}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground/90">
            {nameOf(teamId)}
          </span>
          <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand-dark">
            Group {groupLabel ?? "—"}
          </span>
        </div>
      </section>

      <div className="mt-4 flex gap-2">
        <Link
          href="/photo"
          className="flex-1 rounded-xl px-4 py-3 text-center text-sm font-semibold text-white transition hover:brightness-105"
          style={{
            background: "linear-gradient(135deg, #6fb1e0, #4f8fd0)",
            boxShadow: "0 4px 12px -5px rgba(79,143,208,0.4)",
          }}
        >
          📸 Photo Bomb
        </Link>
        <Link
          href="/awards"
          className="flex-1 rounded-xl px-4 py-3 text-center text-sm font-semibold text-white transition hover:brightness-105"
          style={{
            background: "linear-gradient(135deg, #ec8fae, #d975a0)",
            boxShadow: "0 4px 12px -5px rgba(217,117,160,0.4)",
          }}
        >
          🏆 Vote for awards
        </Link>
      </div>

      <Link
        href="/schedule"
        className="mt-2 block rounded-xl border border-black/10 bg-white px-4 py-3 text-center text-sm font-medium hover:bg-black/[.03]"
      >
        See the draw
      </Link>
      <div className="mt-2">
        <LiveRefresh />
      </div>
      {unresolvedQualificationTie && (
        <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Group {groupLabel} has an exact qualification tie. The knockout is
          waiting while an organiser confirms the bowl-off or drawn-lots order.
        </p>
      )}

      {upNext ? (
        (() => {
          const v = view(upNext);
          const ready = !!v.oppId;
          // Which state is the tile in? waiting = the rink or a team is busy;
          // live = both are clear; tbd = opponent not decided; unknown = ready
          // but no rink assigned yet.
          const { status, aheadGame, aheadCount, blocker } = upNextInfo(
            upNext,
            allFixtures,
            ready,
          );
          const tileClass =
            status === "live"
              ? "rounded-2xl bg-brand/15 p-5 ring-2 ring-brand/50"
              : status === "waiting"
                ? "rounded-2xl bg-amber-50 p-5 ring-1 ring-amber-200"
                : "rounded-2xl bg-brand/10 p-5 ring-1 ring-brand/30";
          const inner = (
            <div className={tileClass}>
              <div className="flex items-start justify-between">
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    status === "waiting" ? "text-amber-800" : "text-brand-dark"
                  }`}
                >
                  {upNext.stage === "knockout"
                    ? `${gameLabel(upNext)} · next`
                    : "Up next"}
                </span>
                {upNext.rink && (
                  <div className="text-right leading-none">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-foreground/40">
                      Where
                    </div>
                    <div
                      className={`mt-0.5 font-display text-lg font-semibold ${
                        status === "waiting"
                          ? "text-amber-900"
                          : "text-brand-dark"
                      }`}
                    >
                      Rink {upNext.rink}
                    </div>
                  </div>
                )}
              </div>
              <p className="mt-1 font-display text-2xl font-semibold tracking-tight">
                v {nameOf(v.oppId)}
              </p>
              {myRank && (
                <p className="mt-1 text-sm text-foreground/70">
                  You&apos;re currently {ordinal(myRank)} of {table.length} in
                  Group {groupLabel}
                </p>
              )}

              {status === "live" && (
                <div className="mt-3 rounded-xl bg-brand px-4 py-3 text-center shadow-sm">
                  <p className="font-display text-lg font-bold text-white">
                    {pick(LIVE_LINES)}
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-white/90">
                    Rink {upNext.rink} is clear — head over now
                  </p>
                </div>
              )}

              {status === "waiting" && aheadGame && (
                <div className="mt-3 rounded-xl bg-amber-100 px-4 py-3 text-center ring-1 ring-amber-200">
                  <p className="font-display text-lg font-bold text-amber-900">
                    {pick(WAITING_LINES)}
                  </p>
                  <p className="mt-1 text-sm text-amber-800">
                    {blocker === "team" ? (
                      <>
                        Waiting for{" "}
                        <span className="font-semibold">
                          {nameOf(
                            aheadGame.team_a_id === upNext.team_a_id ||
                              aheadGame.team_a_id === upNext.team_b_id
                              ? aheadGame.team_a_id
                              : aheadGame.team_b_id,
                          )}
                        </span>{" "}
                        to finish on Rink {aheadGame.rink ?? "TBC"}
                      </>
                    ) : (
                      <>
                        Rink {upNext.rink} is still on with{" "}
                        <span className="font-semibold">
                          {nameOf(aheadGame.team_a_id)} v{" "}
                          {nameOf(aheadGame.team_b_id)}
                        </span>
                        {aheadCount > 1 && (
                          <span className="text-amber-700">
                            {" · "}
                            {aheadCount} games ahead of you
                          </span>
                        )}
                      </>
                    )}
                  </p>
                </div>
              )}

              {status === "unknown" && (
                <p className="mt-2 text-sm font-medium text-brand-dark">
                  You&apos;re up next — head over when you&apos;re called.
                </p>
              )}

              {ready ? (
                <>
                  <p className="mt-3 text-base font-bold text-brand-dark">
                    {status === "waiting"
                      ? "Tap here to enter the score once you've played →"
                      : "Tap to enter the score →"}
                  </p>
                  <p className="mt-0.5 text-xs text-foreground/60">
                    Either team can enter it once you&apos;ve played — first one
                    in locks it.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm font-medium text-brand-dark">
                  Waiting for your opponent to be decided
                </p>
              )}
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
            {myRank
              ? ` — currently ${ordinal(myRank)} in Group ${groupLabel}`
              : ""}
            .
          </p>
          <p className="mt-1 text-sm text-foreground/60">
            {eliminated && myRank != null
              ? `That's your bowling done for the day — you finished ${ordinal(myRank)} in Group ${groupLabel}. Enjoy the knockout and the ceremony!`
              : "Your knockout game will appear here as soon as the groups finish."}
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
                  className="rounded-2xl border border-dashed border-coming-line bg-coming p-4 text-coming-ink"
                >
                  <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">
                    {f.stage === "knockout" ? gameLabel(f) : "Group game"}
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
                  className="block rounded-2xl bg-result p-4 text-foreground/70 ring-1 ring-black/5 hover:bg-result-hover"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">
                      {f.stage === "knockout" ? `${gameLabel(f)} · ` : ""}
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
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Group {groupLabel ?? "—"}</h3>
          <span className="text-xs font-semibold text-brand-dark">
            Top {advance} go through
          </span>
        </div>
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
                className={`${
                  unresolvedQualificationTie &&
                  terminalTie.some((tied) => tied.teamId === row.teamId)
                    ? "bg-amber-100"
                    : row.rank <= advance
                      ? "bg-brand/20"
                      : ""
                } ${
                  row.teamId === teamId ? "font-semibold text-brand-dark" : ""
                }`}
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

      {(isOwner || isAdmin) && (
        <section className="mt-6 rounded-2xl border border-brand/20 bg-brand/5 p-4">
          <h3 className="text-sm font-semibold text-brand-dark">
            🛠 Organiser tools
          </h3>
          <p className="mt-0.5 text-xs text-foreground/60">
            You&apos;re playing and running the show — your tools live here.
          </p>
          <div className="mt-3">
            <OrganiserLinks isOwner={isOwner} isAdmin={isAdmin} />
          </div>
        </section>
      )}

      <Link
        href="/day"
        className="mt-4 block rounded-xl border border-black/10 bg-white px-4 py-3 text-center text-sm font-medium hover:bg-black/[.03]"
      >
        Day plan — schedule, dress code &amp; venue
      </Link>
    </>
  );
}
