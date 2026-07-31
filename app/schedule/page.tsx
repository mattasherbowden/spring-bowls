import { redirect } from "next/navigation";
import Link from "next/link";
import { HomeButton } from "../_components/home-button";
import { LiveRefresh } from "../_components/live-refresh";
import { SBMark } from "../_components/sb-mark";
import { createClient } from "@/lib/supabase/server";
import {
  applyQualificationOverride,
  computeStandings,
  qualificationTieAtCutoff,
  type TeamStanding,
} from "@/lib/domain/standings";
import {
  buildBracket,
  knockoutRoundName,
} from "@/lib/domain/bracket";
import {
  bonusBowlOff,
  isBonusBowlOff,
} from "@/lib/domain/consolation";
import {
  auditGroupSchedule,
  auditKnockoutSchedule,
} from "@/lib/domain/schedule-audit";
import { RefreshKnockoutButton } from "./_refresh-button";
import { QualificationTieResolver } from "./_tie-resolution";
import type { Fixture } from "@/lib/domain/types";
import {
  throwIfAuthUnavailable,
  throwIfSupabaseError,
} from "@/lib/supabase/query-error";
import {
  formatFixtureOpenTime,
  isPlayOpen,
} from "@/lib/domain/play-state";
import { PlayPreviewBanner } from "../_components/play-preview-banner";

type PlayerLite = { display_name: string; nationality: string | null };
type TeamRow = {
  id: string;
  name: string | null;
  group_label: string | null;
  players: PlayerLite[];
};
type FixtureRow = {
  id: string;
  stage: string;
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
type KoRow = {
  id: string;
  match_code: string | null;
  round: number | null;
  team_a_source: string | null;
  team_b_source: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
  status: string;
  shots_a: number | null;
  shots_b: number | null;
  winner_team_id: string | null;
};
type TiebreakRow = {
  group_label: string;
  ordered_team_ids: string[];
};

function sourceLabel(s: string | null): string {
  if (!s) return "TBD";
  if (s.startsWith("W:")) return `winner of ${s.slice(2)}`;
  const m = s.match(/^([A-Z])(\d+)$/);
  if (m) {
    const pos = m[2] === "1" ? "winner" : m[2] === "2" ? "runner-up" : `#${m[2]}`;
    return `Group ${m[1]} ${pos}`;
  }
  return s;
}

function projectedSlot(s: string | null): string {
  if (!s) return "—";
  if (s.startsWith("W:")) return `Winner ${s.slice(2)}`;
  return s;
}

export default async function SchedulePage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  throwIfAuthUnavailable(authError, "schedule authentication");
  if (!user) redirect("/");

  const { data: tournament, error: tournamentError } = await supabase
    .from("tournament")
    .select(
      "id, name, advance, rink_count, ends_per_game, minutes_per_end, status, play_status, fixtures_open_time",
    )
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(tournamentError, "schedule tournament");
  if (!tournament) redirect("/");

  const { data: prof, error: profileError } = await supabase
    .from("profile")
    .select("is_owner, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  throwIfSupabaseError(profileError, "schedule profile");
  const isOwner = !!prof?.is_owner;
  const canManage = isOwner || !!prof?.is_admin;

  const { data: teamsData, error: teamsError } = await supabase
    .from("team")
    .select("id, name, group_label, players:player(display_name, nationality)")
    .eq("tournament_id", tournament.id);
  throwIfSupabaseError(teamsError, "schedule teams");
  const teams = (teamsData ?? []) as TeamRow[];

  const { data: fixturesData, error: fixturesError } = await supabase
    .from("fixture")
    .select(
      "id, stage, group_label, round, rink, order_index, team_a_id, team_b_id, status, shots_a, shots_b, winner_team_id",
    )
    .eq("tournament_id", tournament.id)
    .eq("stage", "group")
    .order("rink", { ascending: true })
    .order("order_index", { ascending: true });
  throwIfSupabaseError(fixturesError, "group schedule");
  const fixtures = (fixturesData ?? []) as FixtureRow[];

  const { data: koData, error: knockoutError } = await supabase
    .from("fixture")
    .select(
      "id, match_code, round, team_a_source, team_b_source, team_a_id, team_b_id, status, shots_a, shots_b, winner_team_id",
    )
    .eq("tournament_id", tournament.id)
    .eq("stage", "knockout")
    .order("round", { ascending: true })
    .order("order_index", { ascending: true });
  throwIfSupabaseError(knockoutError, "knockout schedule");
  const koFixtures = (koData ?? []) as KoRow[];
  const { data: tiebreakData, error: tiebreakError } = await supabase
    .from("qualification_tiebreak")
    .select("group_label, ordered_team_ids")
    .eq("tournament_id", tournament.id);
  throwIfSupabaseError(tiebreakError, "qualification tiebreaks");
  const tiebreakByGroup = new Map(
    ((tiebreakData ?? []) as TiebreakRow[]).map((row) => [
      row.group_label,
      row.ordered_team_ids,
    ]),
  );

  const teamName = (id: string | null): string => {
    const t = teams.find((x) => x.id === id);
    if (!t) return "TBC";
    return t.name ?? t.players.map((p) => p.display_name).join(" & ");
  };
  const scheduleAudit = auditGroupSchedule(
    teams.map((team) => ({
      id: team.id,
      name: teamName(team.id),
      groupLabel: team.group_label,
    })),
    fixtures.map((fixture) => ({
      id: fixture.id,
      groupLabel: fixture.group_label,
      round: fixture.round,
      rink: fixture.rink,
      order: fixture.order_index,
      teamA: fixture.team_a_id,
      teamB: fixture.team_b_id,
    })),
    tournament.rink_count,
  );
  const knockoutIssues = auditKnockoutSchedule(
    koFixtures.map((fixture) => ({
      id: fixture.id,
      matchCode: fixture.match_code,
      round: fixture.round,
      teamASource: fixture.team_a_source,
      teamBSource: fixture.team_b_source,
      teamA: fixture.team_a_id,
      teamB: fixture.team_b_id,
      status: fixture.status,
      shotsA: fixture.shots_a,
      shotsB: fixture.shots_b,
      winnerTeam: fixture.winner_team_id,
    })),
  );
  const baseDrawIssues = [...scheduleAudit.issues, ...knockoutIssues];

  const completed: Fixture[] = fixtures
    .filter(
      (f) =>
        (f.status === "completed" || f.status === "walkover") &&
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
  const groupTables = new Map<
    string,
    {
      table: TeamStanding[];
      terminalTie: TeamStanding[];
      validOverride: boolean;
      initialOrder: string[];
    }
  >();
  const qualificationIssues: string[] = [];
  for (const label of groupLabels) {
    const groupTeamIds = teams
      .filter((team) => team.group_label === label)
      .map((team) => team.id);
    const rawTable = computeStandings(groupTeamIds, completed);
    const groupComplete = rawTable.every(
      (standing) => standing.played === Math.max(0, groupTeamIds.length - 1),
    );
    const terminalTie = groupComplete
      ? qualificationTieAtCutoff(rawTable, tournament.advance)
      : [];
    const override = tiebreakByGroup.get(label);
    const overrideSet = new Set(override ?? []);
    const validOverride =
      terminalTie.length > 0 &&
      override?.length === terminalTie.length &&
      terminalTie.every((standing) => overrideSet.has(standing.teamId));
    const table = validOverride
      ? applyQualificationOverride(rawTable, override)
      : rawTable;
    if (terminalTie.length > 0 && !validOverride) {
      qualificationIssues.push(
        `Group ${label} has an exact tie across the qualification line. Confirm its order below before the knockout can continue.`,
      );
    }
    groupTables.set(label, {
      table,
      terminalTie,
      validOverride,
      initialOrder: validOverride
        ? (override as string[])
        : terminalTie.map((standing) => standing.teamId),
    });
  }
  const drawIssues = [...baseDrawIssues, ...qualificationIssues];
  const rinks = [
    ...new Set(fixtures.map((f) => f.rink).filter((r): r is number => r != null)),
  ].sort((a, b) => a - b);

  // Projected bracket, used only if the real knockout hasn't been created yet.
  const groupSize = new Map<string, number>();
  for (const t of teams) {
    if (t.group_label) {
      groupSize.set(t.group_label, (groupSize.get(t.group_label) ?? 0) + 1);
    }
  }
  const qualifierLabels: string[] = [];
  for (let pos = 1; pos <= tournament.advance; pos++) {
    for (const g of groupLabels) {
      if ((groupSize.get(g) ?? 0) >= pos) qualifierLabels.push(`${g}${pos}`);
    }
  }
  const projected = buildBracket(qualifierLabels);
  const projectedBowlOff = bonusBowlOff(
    groupLabels.map((label) => ({
      label,
      size: groupSize.get(label) ?? 0,
    })),
    tournament.advance,
  );
  const knockoutWaves = projected.reduce(
    (sum, round, roundIndex) =>
      sum +
      Math.ceil(
        (round.matches.filter(
          (match) => match.a !== null && match.b !== null,
        ).length +
          (roundIndex === 0 && projectedBowlOff ? 1 : 0)) /
          tournament.rink_count,
      ),
    0,
  );
  const plannedMinutes =
    (scheduleAudit.waveCount + knockoutWaves) *
    tournament.ends_per_game *
    tournament.minutes_per_end;
  const durationLabel =
    plannedMinutes >= 60
      ? `${Math.floor(plannedMinutes / 60)}h ${plannedMinutes % 60}m`
      : `${plannedMinutes}m`;
  const groupDone = fixtures.filter(
    (fixture) =>
      fixture.status === "completed" || fixture.status === "walkover",
  ).length;
  const postGroupDone = koFixtures.filter(
    (fixture) =>
      fixture.status === "completed" || fixture.status === "walkover",
  ).length;

  const bowlOffFixtures = koFixtures.filter((fixture) =>
    isBonusBowlOff(fixture.match_code),
  );
  const bracketFixtures = koFixtures.filter(
    (fixture) => !isBonusBowlOff(fixture.match_code),
  );
  const koByRound = new Map<number, KoRow[]>();
  for (const k of bracketFixtures) {
    const r = k.round ?? 0;
    koByRound.set(r, [...(koByRound.get(r) ?? []), k]);
  }
  const koRounds = [...koByRound.keys()]
    .sort((a, b) => a - b)
    .map((r) => ({ round: r, matches: koByRound.get(r)! }));
  const finalKnockoutRound = koRounds.at(-1)?.round ?? 0;
  const renderPostGroupMatch = (match: KoRow) => {
    const done =
      match.status === "completed" || match.status === "walkover";
    const slot = (id: string | null, source: string | null) =>
      id
        ? teamName(id)
        : source
          ? `TBA · ${sourceLabel(source)}`
          : "Bye";
    const inner = (
      <div className="rounded-lg border border-black/10 p-2 text-sm">
        <div className="flex items-center justify-between">
          <span>{slot(match.team_a_id, match.team_a_source)}</span>
          {done && <span className="font-semibold">{match.shots_a}</span>}
        </div>
        <div className="flex items-center justify-between">
          <span>{slot(match.team_b_id, match.team_b_source)}</span>
          {done && <span className="font-semibold">{match.shots_b}</span>}
        </div>
      </div>
    );
    return match.status === "pending" ? (
      <div key={match.id}>{inner}</div>
    ) : (
      <Link
        key={match.id}
        href={`/fixture/${match.id}`}
        className="block hover:opacity-70"
      >
        {inner}
      </Link>
    );
  };

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-10">
      <div className="w-full max-w-lg">
        <header className="text-center">
          <div className="flex">
            <HomeButton />
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">
            <SBMark className="mr-2" />Schedule
          </h1>
          <div className="mt-2">
            <LiveRefresh />
          </div>
        </header>

        {tournament.status === "setup" ? (
          <section className="mt-5 rounded-2xl bg-amber-50 p-5 text-center ring-1 ring-amber-200">
            <p className="text-2xl">🛠️</p>
            <p className="mt-1 font-display text-xl font-semibold text-amber-950">
              The organiser is updating the draw
            </p>
            <p className="mt-1 text-sm text-amber-900/75">
              Teams and logins are safe. The revised fixtures will appear here
              once the preview is published again.
            </p>
            {isOwner && (
              <Link
                href="/setup/teams"
                className="mt-3 inline-block text-sm font-semibold text-brand hover:text-brand-dark"
              >
                Continue editing →
              </Link>
            )}
          </section>
        ) : !isPlayOpen(tournament.play_status) ? (
          <div className="mt-5">
            <PlayPreviewBanner
              openTimeLabel={formatFixtureOpenTime(
                tournament.fixtures_open_time,
              )}
              isOwner={isOwner}
            />
          </div>
        ) : null}

        {canManage && fixtures.length > 0 && (
          <section
            className={`mt-5 rounded-xl p-4 text-sm ring-1 ${
              drawIssues.length === 0
                ? "bg-brand/10 text-brand-dark ring-brand/25"
                : "bg-red-50 text-red-900 ring-red-200"
            }`}
          >
            <p className="font-semibold">
              {drawIssues.length === 0
                ? "✓ Draw checks passed"
                : "⚠ Draw needs attention"}
            </p>
            {drawIssues.length === 0 ? (
              <p className="mt-1 text-xs">
                Every group pairing appears once and no team is double-booked
                across the {scheduleAudit.waveCount} group-stage time waves.
                The post-group dependency graph is also valid.
              </p>
            ) : (
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
                {drawIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 border-t border-current/10 pt-2 text-xs">
              Planned minimum: about {durationLabel} including the knockout
              {projectedBowlOff ? " and bonus bowl-off" : ""}, before
              deciders, changeovers or overruns.
            </p>
            <p className="mt-1 text-xs">
              Progress: {groupDone}/{fixtures.length} group games
              {koFixtures.length > 0
                ? ` · ${postGroupDone}/${koFixtures.length} post-group games`
                : ""}
            </p>
          </section>
        )}

        {fixtures.length === 0 ? (
          <p className="mt-6 text-center text-sm text-foreground/60">
            The schedule hasn&apos;t been generated yet.
          </p>
        ) : (
          <div className="mt-6 space-y-6">
            {groupLabels.map((label) => {
              const group = groupTables.get(label);
              const table = group?.table ?? [];
              const terminalTie = group?.terminalTie ?? [];
              return (
                <section
                  key={label}
                  className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"
                >
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold">Group {label}</h2>
                    <span className="text-xs font-semibold text-brand-dark">
                      Top {tournament.advance} go through
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
                          className={
                            terminalTie.length > 0 &&
                            !group?.validOverride &&
                            terminalTie.some(
                              (tied) => tied.teamId === row.teamId,
                            )
                              ? "bg-amber-100"
                              : row.rank <= tournament.advance
                                ? "bg-brand/20"
                                : ""
                          }
                        >
                          <td className="py-1">{teamName(row.teamId)}</td>
                          <td className="text-center">{row.played}</td>
                          <td className="text-center">{row.wins}</td>
                          <td className="text-center">
                            {row.shotDiff > 0 ? `+${row.shotDiff}` : row.shotDiff}
                          </td>
                          <td className="text-center font-medium">
                            {row.points}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {terminalTie.length > 0 &&
                    (canManage ? (
                      <QualificationTieResolver
                        tournamentId={tournament.id}
                        groupLabel={label}
                        teams={terminalTie.map((standing) => ({
                          id: standing.teamId,
                          label: teamName(standing.teamId),
                        }))}
                        initialOrder={group?.initialOrder ?? []}
                        resolved={!!group?.validOverride}
                      />
                    ) : (
                      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                        This group has an exact qualification tie. The knockout is
                        waiting for an organiser&apos;s bowl-off or drawn-lots
                        decision.
                      </p>
                    ))}
                </section>
              );
            })}

            {(bowlOffFixtures.length > 0 || projectedBowlOff) && (
              <section className="rounded-2xl bg-brand/5 p-4 ring-1 ring-brand/20">
                <h2 className="text-sm font-semibold text-brand-dark">
                  Bonus bowl-off · guaranteed third game
                </h2>
                <p className="mt-1 text-xs text-foreground/60">
                  Second and third in Group{" "}
                  {projectedBowlOff?.groupLabel ?? "—"} play on the spare rink
                  alongside the semi-finals. This does not affect the
                  championship.
                </p>
                <div className="mt-3 space-y-2">
                  {bowlOffFixtures.length > 0 ? (
                    bowlOffFixtures.map(renderPostGroupMatch)
                  ) : projectedBowlOff ? (
                    <div className="rounded-lg border border-brand/20 bg-white/70 p-2 text-sm">
                      <div>{sourceLabel(projectedBowlOff.teamASource)}</div>
                      <div className="my-0.5 text-center text-foreground/30">
                        v
                      </div>
                      <div>{sourceLabel(projectedBowlOff.teamBSource)}</div>
                    </div>
                  ) : null}
                </div>
              </section>
            )}

            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
              <h2 className="text-sm font-semibold">Knockout draw</h2>
              {koRounds.length > 0 ? (
                <div className="mt-3 space-y-4">
                  {koRounds.map((round) => (
                    <div key={round.round}>
                      <h3 className="text-xs font-semibold text-foreground/60">
                        {knockoutRoundName(
                          round.round,
                          finalKnockoutRound,
                        )}
                      </h3>
                      <div className="mt-1 space-y-2">
                        {round.matches.map(renderPostGroupMatch)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : projected.length > 0 ? (
                <>
                  <p className="mt-1 text-xs text-foreground/50">
                    Projected — real teams lock in as the groups finish
                    {isOwner ? " (tap refresh below)" : ""}.
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <div className="flex gap-4">
                      {projected.map((round) => (
                        <div
                          key={round.name}
                          className="flex min-w-[9rem] flex-col justify-around gap-3"
                        >
                          <h3 className="text-center text-xs font-semibold text-foreground/60">
                            {round.name}
                          </h3>
                          {round.matches.map((m) => (
                            <div
                              key={m.id}
                              className="rounded-lg border border-black/10 p-2 text-xs"
                            >
                              <div className="truncate">
                                {projectedSlot(m.a)}
                              </div>
                              <div className="my-0.5 text-center text-foreground/30">
                                v
                              </div>
                              <div className="truncate">
                                {projectedSlot(m.b)}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-1 text-xs text-foreground/50">
                  No knockout — the group winner is the champion.
                </p>
              )}

              {isOwner && (
                <RefreshKnockoutButton />
              )}
            </section>

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
                      const done =
                        f.status === "completed" || f.status === "walkover";
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
                              Wave{" "}
                              {Math.floor(
                                f.order_index /
                                  Math.max(1, tournament.rink_count),
                              ) + 1}
                              {" · "}
                              {done
                                ? "✓ done"
                                : `Grp ${f.group_label} · R${f.round}`}
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
