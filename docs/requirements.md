# Spring Bowls — Product Requirements

- **Version:** 0.1 (draft, gathered from host interview)
- **Last updated:** 2026-07-22
- **Event:** Spring Bowls #7, "BYO Brit edition" — Saturday 1 August 2026
- **Author:** Matt (host / owner)

Requirements have stable IDs (e.g. `FR-D3`). Tests reference these IDs so every requirement is traceable to a test (see [test-strategy.md](test-strategy.md)). Anything unresolved is tracked in section 8 and in [edge-cases.md](edge-cases.md).

---

## 1. Overview

A phone-first web app to run a one-day, teams-of-two lawn-bowls tournament for ~24–40 players. One host sets up the tournament (teams, logins, rinks, format); the app then generates the schedule, shows each player where they're up next, takes live scores, keeps the group tables and knockout bracket up to date, and runs the end-of-day awards vote and ceremony. Reusable for future editions.

**Primary goals**
1. Remove the day-of chaos of last-minute drop-outs and "who's on next".
2. Let players self-serve: next fixture, scores, standings, voting.
3. Keep the host in control: fix anything, resolve disputes, end the event.
4. Be fun and simple enough for non-technical guests on their own phones.

**Non-goals (v1)**
- No ball-by-ball or per-bowl stats — just per-end shot scores.
- No payments, no email/SMS, no native mobile app.
- No cross-venue or multi-day tournaments.

---

## 2. Roles

| Role | Who | Can do |
|---|---|---|
| **Owner** | The host (Matt) | Everything an admin can, **plus** create a tournament, add teams/logins, and end/archive the tournament. Exactly one per deployment. |
| **Admin** | Helpers the owner ticks during setup | Unlock/correct any score, override the schedule, open/close voting, reset a player's password. |
| **Player** | Everyone in a team | Log in, see fixtures/rink/standings/bracket, enter their own team's score, vote in awards. |
| **Spectator** | Anyone with the public link | View-only live standings + "now playing / up next". No login, no personal data. |

---

## 3. Scope

**In scope (v1):** owner first-run setup; tournament creation wizard with live time/fixture estimates; team + login management incl. Brit/Kiwi flags; group stage generation; group tables with tiebreakers; single-elimination knockout with byes; predetermined per-rink schedule with live progression and admin override; per-end score entry with lock + admin unlock; live player home ("up next"); awards voting; public big-screen view; end/archive + reuse.

**Out of scope (v1):** self-service password reset by email; handicaps; multiple simultaneous tournaments; historical analytics; internationalisation.

---

## 4. Functional requirements

### FR-A · Accounts, roles & auth
- **FR-A1** First run: with no owner in the system, the app shows a one-time "create owner account" screen (username + password). *AC:* after an owner exists, this screen never shows again; the owner can log in with those credentials.
- **FR-A2** Auth is username + password only; no email is ever requested from a user. *AC:* a user can register/login with only a username; any email used internally is synthetic and never shown.
- **FR-A3** Usernames are unique within a tournament; the setup UI blocks or auto-suffixes duplicates. *AC:* creating two players "will" surfaces a clear conflict and cannot produce two identical usable logins.
- **FR-A4** Passwords are stored only as salted hashes (delegated to Supabase auth). *AC:* no plaintext password is ever stored or logged.
- **FR-A5** Owner and admins can reset a player's password to a new value from the admin panel. *AC:* after reset, old password fails and new password works.
- **FR-A6** Owner recovery: the owner is shown a one-time recovery code at FR-A1 that can reset the owner password. *AC:* a lost owner password is recoverable without database access. *(pending confirmation — see §8)*
- **FR-A7** A logged-in user may be active on multiple devices at once. *AC:* logging in on a second device does not break the first.

### FR-B · Tournament setup wizard
- **FR-B1** Only the owner can start "create tournament". *AC:* an admin or player never sees or can reach the create flow.
- **FR-B2** The wizard is an interactive calculator: inputs are team count, team size (default 2), number of rinks, ends per game, minutes per end (incl. changeover), and advancement rule (top 1 or top 2). *AC:* changing any input immediately updates the outputs in FR-B3 with no page reload.
- **FR-B3** Live outputs: fixtures per team (or range if uneven), total games, group layout, estimated total duration, and estimated finish time given a start time. *AC:* the estimate equals `ceil(total_games / rinks) × (ends × mins_per_end + changeover)` (± documented rounding) and is shown before generation.
- **FR-B4** The wizard proposes a group layout automatically from the team count, and the owner can accept or adjust. *AC:* for N teams the proposal produces balanced group sizes (differ by at most 1) and states fixtures-per-team.
- **FR-B5** Generation is explicit: nothing is created until the owner confirms "generate tournament". *AC:* abandoning the wizard creates no fixtures, teams, or logins.

### FR-C · Teams & players
- **FR-C1** The owner adds teams; each team has 2 players by default, each with a display name, username, and password. *AC:* a team is not valid until it has its full roster.
- **FR-C2** Each player has a nationality flag: **Brit** or **Kiwi** (BYO Brit edition). *AC:* the flag is shown next to the player everywhere and drives the British/Kiwi awards' eligibility.
- **FR-C3** Optional custom team name; otherwise the team is shown as "PlayerA & PlayerB". *AC:* both display forms render correctly across all screens.
- **FR-C4** The owner can mark any player as **admin** during or after setup. *AC:* ticking admin immediately grants admin abilities to that account.
- **FR-C5** Before the tournament is locked, the owner can add/remove/edit teams and re-pair players; the schedule regenerates. *AC:* removing a team before lock leaves a consistent, playable schedule.
- **FR-C6** Drop-outs during play are handled by the owner via substitution or team withdrawal (see FR-F7 walkovers, and edge-cases.md). *AC:* substituting a player keeps the team's existing fixtures and results intact.
- **FR-C7** Teams lock at a defined point (default: when the knockout stage begins) after which rosters can't change without admin action. *AC:* attempting a normal roster edit after lock is blocked with an explanatory message. *(lock point pending — see §8)*

### FR-D · Group stage & standings
- **FR-D1** Each group is a round-robin: every team plays every other team in its group once. *AC:* for a group of `g` teams, exactly `g×(g-1)/2` fixtures are generated.
- **FR-D2** A game result is win/loss only — **no draws** (see FR-F). Points: win = 1, loss = 0.
- **FR-D3** Group ranking order: (1) points, (2) shot difference [shots for − shots against], (3) shots for, (4) head-to-head result. *AC:* given constructed standings that tie at each level, the tiebreak resolves in this exact order.
- **FR-D4** The group table clearly highlights the qualifying zone (top 1 or top 2 per the advancement rule). *AC:* the exact teams that would advance right now are visually distinct.
- **FR-D5** Standings update live as scores are entered. *AC:* entering a result updates every viewer's table without a manual refresh.

### FR-E · Knockout
- **FR-E1** Single-elimination bracket seeded from group results, with group winners kept apart as far as possible. *AC:* two teams that won the same group's-pool cannot meet before the latest possible round given standard seeding.
- **FR-E2** Byes are auto-added when the qualifier count isn't a power of two; a bye auto-advances its team with no fixture. *AC:* for 6 qualifiers, the bracket resolves with correct byes and no phantom fixtures.
- **FR-E3** Knockout fixtures show placeholders ("Winner Group A") until the feeding results exist, then resolve to real teams. *AC:* a QF cannot start until both feeder results are final; the UI shows what it's waiting on.
- **FR-E4** No 3rd/4th-place playoff. *AC:* only the final decides a champion; no consolation fixture is generated.

### FR-F · Scoring & score entry
- **FR-F1** A game is a fixed number of ends (default 2); players enter each end's shots for both teams. *AC:* totals equal the sum of entered ends.
- **FR-F2** No draws: if the two teams are level after the configured ends, the app requires a 1-end **decider**, repeating until one team leads. *AC:* a level total cannot be submitted as final; the app forces (and accepts) decider ends.
- **FR-F3** Only members of the two teams in a fixture may submit its score; enforced server-side. *AC:* a player from an uninvolved team receives an authorization error even via a direct API call.
- **FR-F4** First valid submission **locks** the fixture and records "entered by <name>". *AC:* after lock, a second player's submit is rejected with a clear "already entered by X" message.
- **FR-F5** Owner/admin can unlock and correct a locked score; the change is attributed and the standings/bracket recompute. *AC:* an admin correction updates all dependent standings and any resolved bracket slots.
- **FR-F6** Optional sanity check on implausible shot counts per end (soft warning, not a hard block). *AC:* an end far above the plausible max prompts a confirmation but can still be saved. *(max bowls/player pending — see §8)*
- **FR-F7** Walkover / no-show: the owner can award a fixture to the present team. *AC:* the awarded result yields the agreed points and shot values and appears in standings. *(walkover scoring pending — see §8)*
- **FR-F8** A game can be marked abandoned by admin and given a manual outcome. *AC:* an abandoned game never blocks tournament progression.

### FR-G · Scheduling & rinks
- **FR-G1** On generation, the app produces a predetermined per-rink running order so players can see where they're up next. *AC:* every group fixture is assigned a rink and a position in that rink's queue.
- **FR-G2** Rink count is set at setup and changeable live; changing it re-flows the remaining order. *AC:* reducing rinks mid-event never double-books a rink or a team.
- **FR-G3** The scheduler avoids putting a team in back-to-back fixtures where possible. *AC:* generated schedules minimise (and clearly display) any unavoidable back-to-backs.
- **FR-G4** As a fixture is finalised, the next fixture on that rink becomes "current" and the following one "up next". *AC:* finalising a score advances that rink's queue for all viewers live.
- **FR-G5** Admin can manually reorder or reassign upcoming fixtures. *AC:* an admin reorder is reflected immediately and consistently for all viewers.

### FR-H · Live player experience
- **FR-H1** A player's home screen leads with their **next fixture**: opponent, rink, and status (up next / your turn / waiting on rink X). *AC:* the "next fixture" is always the player's earliest unfinished fixture.
- **FR-H2** A player can open their fixture and enter the score (subject to FR-F). *AC:* the entry screen is reachable in one tap from home.
- **FR-H3** Players can browse all fixtures, group tables, and the bracket read-only. *AC:* all public tournament state is viewable by any logged-in player.
- **FR-H4** Live updates arrive without manual refresh (realtime). *AC:* a change made by one user appears for others within a few seconds.

### FR-I · Awards & voting
- **FR-I1** Five awards ship pre-loaded, each typed **team** or **individual**: best dressed (team), bowl of the day (individual), cutest couple (team), most British (individual), most Kiwi (individual). *AC:* each renders the correct nominee type.
- **FR-I2** Owner can add, edit, remove awards and set each award's type and description. *AC:* a custom award behaves identically to the pre-loaded ones.
- **FR-I3** Nominees are generated automatically: all teams (team awards) or all players (individual awards), minus the voter's own team/self. *AC:* a voter never sees themselves/their own team as an option.
- **FR-I4** Each voter has exactly 2 votes per award, which must go to 2 **different** nominees. *AC:* a third vote, or two votes on one nominee, is rejected server-side.
- **FR-I5** Votes are changeable any time until voting is closed. *AC:* re-voting replaces a prior vote and the tally reflects it live.
- **FR-I6** Live tally is visible to everyone during voting. *AC:* the standings of an award move as votes come in.
- **FR-I7** Owner/admin can close (and reopen) voting; when closed, no votes are accepted. *AC:* a vote attempt after close is rejected server-side, not just hidden.
- **FR-I8** Winner is most votes; ties handled per §8. *AC:* the ceremony view shows each award's winner(s).
- **FR-I9** British/Kiwi awards restrict nominees to players with the matching flag. *AC:* only Brits appear for "most British", only Kiwis for "most Kiwi".

### FR-J · Public big-screen view
- **FR-J1** A no-login public URL shows live standings and "now playing / up next" per rink. *AC:* it exposes no usernames-as-credentials, scores-entry, or voting controls.
- **FR-J2** Suitable for projecting (large, high-contrast, auto-refreshing). *AC:* readable at a distance; updates live.

### FR-K · Lifecycle & reuse
- **FR-K1** Only the owner can end a tournament; ending archives it read-only and keeps all results. *AC:* an ended tournament's data remains viewable but immutable.
- **FR-K2** After ending, the owner can create a new tournament; player accounts are scoped per tournament. *AC:* a new edition can reuse a username that existed in an archived edition without collision.
- **FR-K3** End-of-day ceremony view: champion + every award winner, plus browseable full results. *AC:* one screen presents the champion and all award results clearly.

---

## 5. Non-functional requirements

- **NFR-1 · Cost:** runs on free tiers (Supabase + Vercel); only optional cost is a custom domain.
- **NFR-2 · Realtime:** state changes propagate to other viewers within ~3s under normal conditions.
- **NFR-3 · Resilience to poor signal:** score/vote submission tolerates flaky connectivity — optimistic UI, explicit "saved / not saved yet" state, and automatic retry. *(hardening level pending — see §8)*
- **NFR-4 · Authorization:** every mutating action is enforced server-side via Supabase Row Level Security; the UI hiding a control is never the only guard.
- **NFR-5 · Accessibility:** phone-first, large tap targets, colour is never the only signal (icons/text too), works on older devices.
- **NFR-6 · Simplicity of entry:** login should be frictionless for guests (e.g. QR code on the login card linking to the site).
- **NFR-7 · Data safety:** results are exportable; the app degrades gracefully if realtime drops (fall back to on-demand fetch).
- **NFR-8 · Availability window:** the deployment must stay awake and reachable across the event day (mind Supabase free-tier inactivity pausing — see edge-cases.md).
- **NFR-9 · Testability & correctness:** all domain logic is pure and unit-tested; the suite gates merges (see test-strategy.md).

---

## 6. Domain model

See [domain-glossary.md](domain-glossary.md) for terms and entities (Tournament, Group, Team, Player, Fixture, End, Award, Vote, Rink).

---

## 7. Traceability

Every FR/NFR with acceptance criteria must have at least one test whose name references the ID (e.g. `FR-D3 · resolves group ties by shot difference before shots-for`). The mapping lives in test names + a generated matrix; see [test-strategy.md](test-strategy.md) §5.

---

## 8. Open decisions (pending host input)

| ID | Question | Working default |
|---|---|---|
| OD-1 | Walkover/no-show scoring (FR-F7) | Win with a configurable set score (e.g. 10–0) |
| OD-2 | Uneven groups vs equal games-per-team (FR-B4/FR-D1) | Allow uneven groups; show the spread |
| OD-3 | Offline hardening level (NFR-3) | Build robust (assume patchy signal) |
| OD-4 | Individual-award voting: block self only, or whole team? (FR-I3) | Block self only |
| OD-5 | Award vote ties (FR-I8) | Co-winners; owner may break the tie |
| OD-6 | Team lock point (FR-C7) | At knockout start |
| OD-7 | Owner password recovery mechanism (FR-A6) | One-time recovery code at first run |
| OD-8 | Sanity cap: max bowls per player for FR-F6 warning | 4 (standard pairs) → warn above 8/end |

The background edge-case sweep will append additional items and refine these before build. Resolved decisions move into [decisions.md](decisions.md).
