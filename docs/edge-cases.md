# Edge cases & user-testing log

A living log of things that can go wrong, ambiguous rules, and what to probe during user testing. Each item aims to become a test (see [test-strategy.md](test-strategy.md)) or a resolved decision (see [decisions.md](decisions.md)).

> **Status:** the automated multi-lens sweep is complete and merged into §2 below (65 ranked items). §1 is the host-facing shortlist; §3 tracks decisions still needed.

## 1. Notable edge cases (host-facing shortlist)

**Drop-outs & teams**
- Partner cancels on the morning → owner substitutes a spare or re-pairs two solos; existing fixtures/results survive.
- A whole team withdraws mid-tournament → remaining fixtures become walkovers (scoring: OD-1).
- Odd number of teams → uneven group sizes; some teams play one more group game (OD-2).
- Player wants to swap partner after knockout starts → blocked unless admin overrides (team lock, OD-6).

**Scoring**
- Level after 2 ends → decider forced; decider also level → another decider (repeat until a leader).
- Someone locks a wrong score → admin unlocks, corrects, and standings/bracket recompute.
- Both players tap submit within a second → first wins the lock; second sees "already entered by X" (no double-write).
- Game abandoned (weather/injury) → admin sets a manual outcome; never blocks progression.

**Scheduling & knockout**
- A game overruns → its rink's queue simply waits; admin can move the next fixture to a free rink.
- A rink is lost mid-event → owner reduces rink count; remaining order re-flows with no double-booking.
- A group runs slow → dependent quarter-final shows "waiting on Group C" until both feeders are final.
- Qualifier count isn't a power of two → correct byes; a bye advances with no phantom fixture.

**Voting**
- Voting for yourself (individual) or your own team (team award) → blocked server-side (OD-4 for partner).
- Changing a vote after casting → replaces the old one; live tally moves.
- Award ends in a tie → OD-5.
- Admin closes voting → later vote attempts rejected by the server, not just hidden.

**Auth & ops**
- Owner forgets their own password (no email) → recovery code (OD-7).
- Two guests both named "Will" → unique usernames enforced/suffixed at setup.
- Poor phone signal at the green → optimistic save + "not saved yet" + retry (NFR-3, OD-3).
- Supabase free tier pauses the project from inactivity before the event → keep-warm / pre-event check so the link is live on the day.
- New edition reuses an old username → allowed; accounts are scoped per tournament.
- Multiple browsers/devices → each keeps its own cookie-based session; a fresh browser shows the login page (never someone else's session), and one account can be live on several devices. **Open gap:** a genuinely shared device / kiosk needs an obvious "log out between users" affordance.

**Security**
- Player crafts a direct API call to score another team's fixture or cast a 3rd vote → rejected by Row Level Security (tested, not assumed).
- Spectator (public view) tries any mutation → no path exists and the server refuses.

## 2. Consolidated catalogue (from automated sweep)

From 127 raw cases across 11 lenses, consolidated to **65** items (35 high-severity). Each is a candidate test — the `Test` line is the behavioural assertion (see [test-strategy.md](test-strategy.md)).

### Auth and accounts · 11

- **Owner locked out with no email reset** — 🔴 high
  - _Scenario:_ The owner sets their login on the first-run screen weeks ahead, then forgets or mistypes the password on tournament morning. Auth is username+password with only a dummy behind-the-scenes email, so Supabase's email reset flow points at an unreadable inbox. The one person who can create/end tournaments and grant admin is locked out with players arriving.
  - _Handling:_ Do not rely on email reset for the owner. Provide out-of-band recovery: a one-time recovery code shown once at first-run setup (told to screenshot it), plus a documented service-role/SQL reset path Matt keeps. Consider a second co-owner break-glass account.
  - _Test:_ In staging, create an owner then attempt login with a wrong password until any lockout triggers; assert at least one documented path (recovery code OR service-role reset) restores owner login without reading the dummy inbox, and the restored session keeps owner role and can still end the tournament.
- **Privileged mutations enforced only in the UI, not in RLS** — 🔴 high
  - _Scenario:_ The unlock, schedule-override, and close-voting buttons are hidden from non-admins in the UI, but the underlying Supabase mutations check nothing. Any logged-in player (or a stale-role former admin) can craft the request directly and unlock a fixture or close voting early, corrupting results.
  - _Handling:_ Enforce every privileged mutation (unlock fixture, override schedule, close voting, change roles) in RLS/policy against the current server-side role, never just conditionally rendered buttons. Add row-level policies keyed to role.
  - _Test:_ As an ordinary authenticated player, call the unlock-fixture and close-voting mutations directly via the Supabase client (bypassing the UI); assert both are rejected by policy. Repeat as admin and assert they succeed, proving the gate is server-side.
- **Role change doesn't propagate to a live session** — 🔴 high
  - _Scenario:_ Mid-tournament the owner promotes a helper to admin or demotes someone. The affected user has an open session with a cached JWT/role claim. Until re-login or token refresh they can't use the new admin button, or worse a demoted admin keeps powers because RLS reads a stale role claim baked into the JWT.
  - _Handling:_ Put role in a DB table checked by RLS on every request so changes take effect immediately (preferred). If role lives in JWT claims, force a token refresh/re-auth on change. Never gate admin actions solely on a client-cached role. Surface a 'permissions changed, please refresh' prompt via realtime.
  - _Test:_ Promote player P to admin while P has an active session; without P logging out, have P unlock a locked fixture and assert it now succeeds. Demote P and assert the same action is rejected server-side within one refresh cycle, even if the old button still shows.
- **Username collision / case & whitespace variance at registration** — 🔴 high
  - _Scenario:_ Login is username-only. Two players both register as 'James'/'JamesB', or a self-registered name clashes with an owner-pre-created one. If usernames aren't uniquely enforced with canonicalization ('James' vs 'james ' vs 'JAMES'), score-entry authorization and 'in by <name>' locking attach to the wrong account.
  - _Handling:_ Enforce a canonical uniqueness rule server-side (trim + case-fold before uniqueness check and login lookup), return a clear 'that name is taken', and ensure the derived dummy email is also collision-free.
  - _Test:_ Register 'James', then attempt 'james', ' James ', and 'JAMES'; assert all three are rejected as duplicates. Log in as the original with each casing and assert it resolves to the same single user id so a fixture locks under one identity.
- **Dummy email synthesized from raw username collides or is malformed** — 🔴 high
  - _Scenario:_ A dummy email is built from the username (james@springbowls.local). Usernames with spaces, apostrophes (O'Brien), unicode or emoji produce invalid or duplicate synthetic emails, so Supabase signup silently fails or maps two usernames to one email, merging two people into one account.
  - _Handling:_ Generate the dummy email from a guaranteed-unique stable id (uuid or sanitized slug + counter), never from raw input, and validate it before calling Supabase. Reject/sanitize usernames that can't form a valid local-part with a visible message.
  - _Test:_ Register 'O'Brien', 'José', and 'James Brown' (with space); query the auth table and assert every account has a distinct RFC-valid dummy email and a distinct user id, and each login returns a different session subject.
- **Self-registration lets someone occupy another player's slot** — 🟠 medium
  - _Scenario:_ If players self-register at the venue, someone can register a teammate's name before they arrive, or register into the wrong team, gaining the ability to submit that fixture's score. With no email verification nothing ties a username to the real human, so 'in by James' is only as trustworthy as who grabbed the name first.
  - _Handling:_ Decide the registration model: owner/admin pre-creates all accounts and assigns teams, or self-registration requires admin approval/assignment before the account can submit scores. Bind score-entry authorization to admin-set team membership, not to a self-chosen name.
  - _Test:_ As player A, register and attempt to submit a score for a fixture involving team X to which A was never assigned; assert RLS rejects it. Have an admin assign A to team X and assert the same submission now succeeds.
- **Login fails on case/whitespace variance, no self-recovery** — 🟠 medium
  - _Scenario:_ Even with unique registration, a player who registered 'JamesB' types 'jamesb' or ' JamesB' on a mobile keyboard (autocapitalize, trailing autocomplete space) and login fails repeatedly. They assume they forgot the password and can't self-recover because there's no email reset.
  - _Handling:_ Apply the same canonicalization (trim + case-fold) to the username on login lookup as on registration, and set inputmode/autocapitalize=off on the field. Give an error that softly distinguishes 'no such user' from 'wrong password'.
  - _Test:_ Register 'JamesB' with a known password, log in with ' jamesb ' and the correct password; assert success resolving to the same account. Assert a genuinely wrong password with the correct username still fails.
- **Session expiry / free-tier pause mid-scoring loses auth and entered ends** — 🟠 medium
  - _Scenario:_ The Supabase free project pauses after inactivity, the JWT expires over a long lunch, or poor signal drops the token refresh. A player returns to enter a decider end and their session is silently dead: the submit appears to work but is rejected as unauthenticated, or the app boots them to login and loses the half-entered end.
  - _Handling:_ Detect auth failures on write and distinguish them from network failures; queue/retry the score locally and re-prompt for login without discarding entered ends. Keep a warm-up ping so the free-tier project isn't cold for the first score. Show an explicit 'signed out - tap to sign back in' state.
  - _Test:_ Enter a full end's shots, expire/invalidate the token before submitting; assert a re-auth prompt (not a silent failure), the entered shots survive re-login, and after re-auth the same submission goes through and locks the fixture.
- **Owner is a single point of failure for admin powers on the day** — 🟠 medium
  - _Scenario:_ Only the owner can create/end a tournament and grant admin. On the day the owner is playing on a rink, phone dead, or off-site; a score needs unlocking or voting needs closing and nobody else has admin yet. The role model has no fallback when the owner is unavailable at the moment admin powers are first needed.
  - _Handling:_ Prompt the owner during setup to designate at least one admin before the tournament starts (a required or prominently warned wizard step). Consider letting an existing admin grant admin to others so the chain doesn't dead-end on one person.
  - _Test:_ Generate a tournament and assert the wizard blocks 'start' (or warns prominently) until a non-owner admin exists. As a non-owner admin, attempt to grant admin and assert the result matches Matt's decision (allowed or explicitly forbidden with a clear message), not a 500.
- **Deleting/renaming an account that already locked a fixture or cast votes** — 🟠 medium
  - _Scenario:_ An admin fixes a duplicate or mistyped account by deleting or renaming it mid-event. That account already locked a fixture ('in by <name>') and cast award votes. Deletion orphans the lock (broken FK or 'in by [null]') and drops or double-counts votes, skewing standings and the tally.
  - _Handling:_ Prefer rename/merge over delete for accounts with activity; on merge, reassign locks and votes to the surviving account and dedupe votes (respect 2-per-award / 2-distinct-nominees). Block hard-delete of an account with scores/votes, or soft-delete preserving the 'in by' attribution.
  - _Test:_ Have account A lock a fixture and cast max votes in an award, then merge A into B; assert the lock now attributes to B (no null, no broken FK), tournament results are unchanged, and A+B combined votes still obey the 2-per-award / 2-distinct limit.
- **Same account on two devices submits the same fixture/vote twice** — 🟡 low
  - _Scenario:_ One login per person, but a couple shares a phone or one partner logs in on phone plus the big-screen laptop. Concurrent sessions on the same account submit the same fixture score twice, or the 'in by <name>' lock races between two tabs of the same user.
  - _Handling:_ Allow multiple concurrent sessions (don't force single-session logout on flaky signal) but make submission idempotent with the version-guard + first-write-locks + whole-ballot-upsert mechanisms; the stale-version write is rejected with 'this changed, reload'. Surface the conflict so the user knows which value stuck.
  - _Test:_ From two sessions of the same user, submit conflicting values for one fixture with the same base version; assert exactly one commits, the other gets a conflict/reload response, and after reload both sessions show the identical committed value.

### Teams, drop-outs and substitutions · 12

- **Orphaned partner after a late single drop-out** — 🔴 high
  - _Scenario:_ The wizard generated groups/fixtures for a fixed team count. On the morning one player of a team is sick; their partner shows up wanting to play. The app models a team as two bound logins, and the whole fixture list, group composition and byes were computed from a fixed team count, so a lone partner has no valid slot.
  - _Handling:_ Support two explicit owner/admin actions: attach a spare to the orphaned partner (keep the slot, relabel the team) or withdraw the whole team. Never silently allow a solo 'team'. Lock teams at 'Generate'; after that, changes go through an explicit repair flow that recomputes fixtures and warns that regeneration discards already-entered scores for that group.
  - _Test:_ Generate fixtures, withdraw one player, and assert the app blocks that team's remaining fixtures from being scored by the lone partner and surfaces a repair prompt rather than allowing a 1-person submission to lock a fixture.
- **Whole-team withdrawal mid-group corrupts standings and tiebreakers** — 🔴 high
  - _Scenario:_ A team plays 1 of 3 group games then both players leave at lunch. Remaining teams have inconsistent played-counts, and ranking by points then shot difference then shots-for then head-to-head is distorted by the abandoned team's partial results, including who qualifies.
  - _Handling:_ Force an explicit owner decision: either void all of the withdrawn team's results (including played ones) so every remaining team has a clean equal schedule, or award walkovers for their unplayed games with a defined default score. Pick ONE policy, apply it consistently, and show a banner on the group table explaining the withdrawal and handling.
  - _Test:_ In a 4-team group, play one real result against a team that then withdraws, apply the chosen policy, and assert the qualifying-zone highlight and final group order match a hand-computed table under that policy.
- **Substitute added mid-tournament and score-entry authority** — 🔴 high
  - _Scenario:_ A spare replaces a sick player after group games have started. Score entry is gated by RLS on team membership. If the sub is added as a brand-new team they lose authority over the team's fixtures; if added by swapping the login they may retroactively appear as 'in by <sub>' on games they never played.
  - _Handling:_ Model substitution as a roster change on the SAME team_id (replace the player slot, keep team identity and fixtures). RLS authorizes by current membership so the sub can immediately submit remaining fixtures. Preserve original 'in by <name>' attribution on already-locked scores (attribution is historical, not recomputed).
  - _Test:_ Lock a group score as player A, substitute A with spare S on the same team, then have S submit the next fixture. Assert S can submit the new fixture AND the earlier locked fixture still shows 'in by A', not 'in by S'.
- **Team count change after a drop-out breaks group/bracket math** — 🔴 high
  - _Scenario:_ Bracket and byes were computed for N teams. Withdrawing a team changes N, turning a clean bracket into one needing new byes, or leaving a group of only 2 teams (a single game deciding qualification). The 'group winners kept apart' seeding also assumed the original count, and a fixture can point at a withdrawn team that can never be scored.
  - _Handling:_ On withdrawal, recompute byes and knockout seeding rather than leaving a phantom team. If a group drops below viable size, prompt the owner to merge/reseed. Never leave a fixture referencing a withdrawn team that blocks schedule progression.
  - _Test:_ Withdraw a team so a group drops to 2 and a bracket slot loses its opponent. Assert no un-scoreable fixture references the withdrawn team and the knockout has no phantom opponent that stalls advancement.
- **No-show discovered only when the opponent tries to score** — 🔴 high
  - _Scenario:_ A team quietly never turns up and nobody withdraws them. Their scheduled opponent waits, then tries to enter a result. Because a fixture needs both teams and scoring expects real end-by-end shots, the opponent can't claim the walkover and the rink schedule stalls.
  - _Handling:_ Provide an admin 'walkover / no-show' action on a fixture that records a defined default result (a set walkover score and 1-0 points) without end-by-end entry, advances the rink schedule, and logs who marked it. This resolves a single fixture, distinct from a full withdrawal.
  - _Test:_ Mark a fixture as a no-show walkover; assert the winning team gets the walkover points in the standings and the rink's running order advances to the next game without any end shots being required.
- **Player ends up on two active teams after a sub** — 🟠 medium
  - _Scenario:_ A generous player spares for a short-handed team while still playing with their own partner, or an admin copies a login into a second team. One login is now on two active teams, both with live fixtures, and RLS lets them submit for both, possibly in overlapping schedule slots on different rinks.
  - _Handling:_ Enforce a DB-level uniqueness constraint: one active player login belongs to at most one active team at a time. Substitution must remove them from any prior active team. Surface a clear error if an admin tries to place someone already on an active team.
  - _Test:_ Attempt to add player P to team B while P is active on team A; assert the second assignment is rejected at the database level (not merely hidden) and P's submit rights remain on only one team.
- **Re-pairing two orphaned players distorts the schedule** — 🟠 medium
  - _Scenario:_ Two different teams each lose a player and the host merges the two survivors into one new pairing. Those players were in different groups with different opponents and different games-already-played, so the merged team has no coherent place in the schedule.
  - _Handling:_ Define a rule: a re-paired team takes over ONE existing team's slot/fixtures (the other original team is withdrawn per the withdrawal policy), or is a fresh entry only if done before generation. Never average two half-played schedules. Make the host choose which slot the new pair inherits.
  - _Test:_ Re-pair survivors into slot X (withdrawing slot Y); assert the new team's remaining fixtures are exactly slot X's unplayed fixtures, slot Y is handled by the withdrawal policy, and no player appears in two active teams.
- **Substitution during the knockout stage** — 🟠 medium
  - _Scenario:_ A team qualifies for the single-elimination bracket then loses a player before a knockout game. Unlike groups, a knockout drop-out must resolve immediately or the bracket can't proceed.
  - _Handling:_ Allow a same-slot substitute so the qualified team keeps its bracket position and can be scored. If no spare is available, advance the opponent by walkover rather than stalling. Decide explicitly whether a substitute is permitted in knockout at all, since some hosts want the pair that qualified to be the pair that plays.
  - _Test:_ In a knockout game, substitute one player and assert the team keeps its slot and can be scored; in a separate run remove the player with no sub and assert the opponent advances by walkover rather than the bracket freezing.
- **Withdrawn/re-paired teams pollute awards nominees and cast votes** — 🟠 medium
  - _Scenario:_ Nominees are auto-generated as 'all eligible minus own'. Team and individual award lists were built from the original roster. A team withdraws or a player is substituted after voting opens; existing ballots may point at an absent nominee, or the sub isn't nominatable, and 'minus own' may follow a stale team.
  - _Handling:_ Decide eligibility policy: withdrawn teams that actually attended stay nominatable for team awards, but the 'minus own' exclusion must follow the voter's CURRENT team after re-pairing. When a nominee is removed, handle existing votes for them explicitly (kept or voided) rather than silently dropping, so 'most votes wins' isn't skewed by a nominee who can't win.
  - _Test:_ Cast a vote for team T for 'best dressed' then withdraw T; assert the tally and 'nominee removed' handling follow the chosen policy (e.g. vote explicitly voided with the voter's remaining vote still counting) rather than a silent 1-vote-lost ballot.
- **Ambiguous lock point for when teams become immutable** — 🟠 medium
  - _Scenario:_ The wizard lets teams be edited freely, but there's no defined moment after which roster changes are 'substitutions' rather than 'edits'. Editing a team after generating fixtures either blocks confusingly or silently corrupts the computed schedule.
  - _Handling:_ Define three explicit phases: (1) pre-generation, free editing; (2) generated but pre-first-score, roster edits allowed and fixtures safe to recompute; (3) play started, only same-slot substitutions and policy withdrawals, never free add/remove. Show the current phase in the admin UI.
  - _Test:_ Enter phase 3 by locking one score, then attempt to add a brand-new team; assert the app offers only substitute/withdraw actions and refuses a raw team-add, whereas the same action in phase 2 is allowed.
- **Odd player count at setup leaves an unpaired single** — 🟠 medium
  - _Scenario:_ Registrations come in odd (e.g. 29) because a partner cancelled during sign-up. Teams are pairs, so one person has no partner and the wizard's team-count/fixtures math assumes clean pairs.
  - _Handling:_ The wizard must detect an unpaired leftover before generation and force resolution: pair with a reserve, mark as waiting for a spare, or exclude, never generate with a half-populated slot. Show the count of unpaired players prominently alongside the live estimate.
  - _Test:_ Enter an odd number of players and attempt to generate; assert generation is blocked with a specific 'N players unpaired' message and the estimate renders no phantom team, rather than silently rounding to an even count.
- **Reserve pool login vs late self-registration collision** — 🟡 low
  - _Scenario:_ The host expects spares but auth is one login per person. A reserve either has no account until needed (can't be nominated/authorized) or self-registers a login that then needs grafting onto a team, risking a mismatch with an account an admin also creates for them.
  - _Handling:_ Support pre-creating 'reserve' logins that exist in no team (no fixture, not a nominee) until assigned, and make assignment idempotent so an admin-created and a self-registered reserve reconcile rather than duplicate. Reserves stay out of standings and nominee lists until activated.
  - _Test:_ Create a reserve login and confirm it appears in no group table, fixture, or nominee list; then assign it as a sub and assert it appears only on the target team and gains submit rights for that team's remaining fixtures.

### Group generation and fairness · 10

- **Awkward/prime team counts force wildly uneven group sizes** — 🔴 high
  - _Scenario:_ Owner enters a prime count like 13. The generator might produce groups of 5/4/4 where a team in the 5-group plays 4 round-robin games while a team in a 3-group plays 2, doubling exposure to shot-difference swings and time on the green before knockout.
  - _Handling:_ Constrain group sizes to differ by at most 1. Surface the resulting group-size distribution and per-team game count in the wizard preview BEFORE generation so Matt sees the imbalance and can adjust rinks/ends or accept it. Never silently pick a lopsided split.
  - _Test:_ Feed the generator every team count from 12 to 20; assert for each that max(group_size) - min(group_size) <= 1 and no team's round-robin game count differs from another's by more than 1.
- **Uneven group sizes make cross-group points ranking unfair** — 🔴 high
  - _Scenario:_ A 4-team group gives each team up to 3 points over 3 games; a 3-team group gives up to 2 points over 2 games. Seeding qualifiers from different groups by raw points compares totals earned over different numbers of games, so a 2-point runner-up and a 2-point winner are treated as equal.
  - _Handling:_ Seed the knockout only by within-group rank (1st, 2nd), never by raw cross-group points. Where a cross-group comparison is unavoidable (which 2nd gets a bye/easier side), use win ratio or points-per-game, not raw totals, and document the rule.
  - _Test:_ Construct groups of size 4 and 3 where the 3-team group's winner has fewer raw points than the 4-team group's runner-up; assert the bracket still seeds the group winner above the other group's runner-up and no slot is assigned by comparing raw point totals across groups.
- **Group ranking undefined on a circular/absent head-to-head tie** — 🔴 high
  - _Scenario:_ Teams finish level on points, shot difference, and shots-for; the final tiebreaker is head-to-head, but in a 3-way tie A beat B, B beat C, C beat A, so head-to-head is circular and resolves nothing (and is undefined for >2 teams). An unhandled tie can crash the standings render or silently fall to insertion/alphabetical order, handing qualification to whoever was entered first. Head-to-head among >2 tied teams must be a recomputed mini-league, not naive pairwise.
  - _Handling:_ Implement head-to-head as a recursive mini-league among exactly the tied teams (recompute points then shot-diff on that subset), recursing if a sub-tie remains, then a deterministic terminal step (fewest shots-against, then a visible coin-toss/manual admin choice). Detect cycles and fall through rather than looping; never resolve silently by row order. Show the mini-league table to admins.
  - _Test:_ Seed a group where three teams are identical on points/shot-diff/shots-for with a circular head-to-head (A>B>C>A); assert the standings return a strict deterministic order without throwing and NOT simply the insertion order. Separately, where 3 tied teams' mini-league order differs from their overall shot difference, assert the final rank follows the mini-league.
- **Non-power-of-two qualifiers force byes and seeding conflicts** — 🔴 high
  - _Scenario:_ 'Top 1 or 2 advance' with a variable group count yields qualifier counts like 5, 6, 10, 12, not powers of two. The bracket must pad with byes to the next power of two while keeping group winners apart and byes going to top seeds. A naive builder gives a bye to a runner-up, collides two group winners in round one, or makes 'winners kept apart' + 'no same-group rematch' + 'byes to winners' mutually unsatisfiable for some counts and silently violates one.
  - _Handling:_ Pad to the next power of two with byes assigned to the highest seeds, seed so group winners can't meet before the latest round and no first-round pairing is same-group, and validate the bracket against these invariants before it goes live. Define an explicit priority order of constraints and report which one was relaxed when they conflict; don't claim 'winners kept apart' unconditionally when the count makes it impossible.
  - _Test:_ Generate brackets for 5, 6, and 10 qualifiers; assert first-round byes equal nextPow2 minus qualifiers, byes go to the top seeds/distinct group winners, no two group winners meet in round one, and no first-round pairing is same-group. Where a constraint must be relaxed, assert the app surfaces which one.
- **Bye/walkover shot-difference distorts tiebreakers** — 🔴 high
  - _Scenario:_ A team is credited a walkover (withdrawal or no-show) or a padding bye. Bowls has no standard walkover margin. If a bye counts as a win with an invented shot margin it swings shot-difference and shots-for tiebreakers unpredictably; a knockout bye that invents a score is worse.
  - _Handling:_ Decide and document walkover scoring: award the point but record 0-0 shots (no shot-difference contribution) or a fixed nominal margin, applied consistently. Knockout byes advance the team with no invented score. Make byes visually distinct in standings ('bye', not a played result).
  - _Test:_ Give a team a walkover/bye plus a real 8-6 win; assert standings show correct points, the bye contributes exactly the documented shot-difference amount, every other team's shot-difference is unaffected, and the bye row is flagged as a bye.
- **Odd qualifier count under top-1 gives a lopsided bracket** — 🔴 high
  - _Scenario:_ 'Top 1 advances' with 5 groups yields 5 qualifiers for a knockout needing 8 slots, so 3 teams get first-round byes and 2 must play. Which winners get byes is ambiguous, and 'group winners kept apart' plus byes-to-winners can conflict, giving some winners a materially easier path.
  - _Handling:_ Seed byes to the highest-ranked group winners by a defined cross-group metric (points-per-game / shot diff), byes to top seeds only. Warn in the wizard when qualifier count isn't a power of two ('5 groups, top-1: 3 teams get byes') so Matt can choose top-2 or a different group count. Make the assignment visible and justified.
  - _Test:_ Configure 5 groups, top-1; assert the bracket has 8 slots with 3 byes, all 3 byes go to distinct group winners, and the recipients are the 3 best winners by the documented metric, not arbitrary order.
- **Large group blows up game count and run-time estimate** — 🔴 high
  - _Scenario:_ Few groups or a day-of rink drop produces one 7-8 team group. A round-robin of 8 is 28 games, of 7 is 21. On limited rinks the day physically cannot finish. If the wizard estimate treats group games linearly rather than C(n,2), Matt commits to an impossible schedule.
  - _Handling:_ The live calculator must compute group games as the sum over groups of C(size,2), not a linear guess, and flag when total games * minutes-per-game / rinks exceeds available hours. Cap suggested group size (~5) and steer toward more, smaller groups for large fields.
  - _Test:_ Set inputs producing one 8-team group; assert the displayed group-game count equals 28 and the run-time estimate is at least 28*(ends*minutes-per-end)/rinks; increase rinks and assert the estimate drops proportionally, proving it uses real C(n,2) counts.
- **Regenerating/editing after fixtures are scored orphans results** — 🔴 high
  - _Scenario:_ Matt regenerates groups or adds/removes a late team after some group fixtures already have scores. If regeneration reshuffles group membership or fixture IDs, entered scores vanish, attach to the wrong fixture, or leave a team with a partial record, silently corrupting standings and qualification.
  - _Handling:_ Once any score exists, block full regeneration; require an explicit destructive-confirm that wipes scores, or support additive editing (add/remove a team) that recomputes fixtures without touching unaffected results. Late team changes are an admin flow with a clear warning about which fixtures/scores are invalidated.
  - _Test:_ Enter a score for one group fixture then add a new team via the edit flow; assert either regeneration is blocked pending explicit confirmation, or the previously-entered score still maps to the same two teams and correct fixture after recompute.
- **Minimum viable group size (2-team groups are single games)** — 🟠 medium
  - _Scenario:_ Small turnout split into groups of 2: a 'round-robin group' of 2 is one game, and under top-2 both teams qualify so the game only affects seeding; under top-1 the single game IS the group with no margin for a bad end or mis-score and no shot-difference safety net.
  - _Handling:_ Enforce a minimum group size of >=3 where the team count allows, and warn when configuration produces 2-team groups ('each group is a single game; both advance under top-2 - consider one big group or top-1'). Offer a single round-robin league as an alternative for very small fields.
  - _Test:_ Feed 8 teams and assert the generator forms groups of size >=3 (2-team only if unavoidable) or raises a wizard warning naming the number of 2-team groups, rather than silently producing 4 groups of 2.
- **Fixtures-per-team shown as a single misleading number** — 🟠 medium
  - _Scenario:_ The wizard advertises 'fixtures-per-team' as one number, but uneven groups (4/3/3) mean teams genuinely have different fixture counts (3 vs 2). A single headline figure is a lie for some teams and undermines trust when a player notices they got fewer games than a friend.
  - _Handling:_ Show fixtures-per-team as a range or per-group breakdown ('most play 2, one group plays 3') rather than a single figure, making the imbalance explicit so Matt can equalize by changing group count/size before generating.
  - _Test:_ Configure a team count yielding groups of 4 and 3; assert the preview displays a range or per-group figure (min 2, max 3) matching the actual generated fixtures per team, not a single scalar.

### Scoring and game rules · 11

- **Concurrent conflicting submits race the fixture lock** — 🔴 high
  - _Scenario:_ Both teams finish entering ends at once (poor signal, delayed sync) and both devices rendered the fixture as unlocked, so both pass the client-side check. Team A submits 21-18, Team B submits 18-21 within a second. Depending on the lock implementation the second write silently overwrites, both land as separate rows, or the lock flag and data land in different transactions.
  - _Handling:_ Enforce the lock atomically in one DB write inside a Supabase RPC: conditional UPDATE ... WHERE locked_by IS NULL (or a unique partial index / status CAS), so the first write wins and sets locked_by and the second matches zero rows and returns a distinct 'already locked by <name>' result the client shows as a toast, never a silent overwrite or merge. RLS also restricts writes to the two teams in the fixture.
  - _Test:_ Fire two conflicting submit RPCs for the same fixture from two authorized team accounts with no artificial ordering; assert exactly one row exists, its values equal the first-committed submission verbatim (never merged), locked_by is that submitter, and the second call returns 'already locked' not a 200/overwrite.
- **Level after 2 ends but the decider end is also tied** — 🔴 high
  - _Scenario:_ No draws allowed, so a level score after 2 ends forces a decider end. But a bowls end can score 0-0 (measure too close, or the jack killed and replayed) or players enter tied shot counts. The match is still level; the app must neither accept a draw nor silently drop the entry.
  - _Handling:_ Validate the decider server-side: it must produce a strictly positive margin for one side. Reject a 0-0 or tied decider ('decider must have a winner, replay the end') and allow entering a further decider end rather than locking a drawn result. The server recomputes level-ness from stored ends and only accepts a decider write when its own computation says one is required.
  - _Test:_ Enter 2 ends level, submit a decider end that is also tied; assert the fixture is NOT marked complete, no winner/points are awarded, and the UI prompts for another decider. Separately submit a decider to a fixture NOT level after 2 ends and assert the server rejects it.
- **Ends entered out of order or duplicated under poor signal** — 🔴 high
  - _Scenario:_ Poor signal: a player enters end 2 before end 1 syncs, or end 1 is retried and duplicated when the network flaps. The 'level after 2 ends -> decider' logic and per-end totals depend on a correct, de-duplicated, ordered set of ends; duplicated or out-of-order ends give a wrong match total and can wrongly trigger or skip the decider.
  - _Handling:_ Make end submission idempotent with a unique constraint on (fixture_id, end_number) and a client-supplied end number and idempotency key, so retries don't duplicate, and compute the match from the canonical set regardless of arrival order. Show the player the reconciled per-end list so they can spot a missing end before locking.
  - _Test:_ Submit end 2 before end 1, then re-submit end 1 twice; assert exactly one row per end number, the match total is order-independent, and the decider is triggered only if the deduped 2-end total is actually level.
- **Correcting a locked score must ripple through standings and bracket** — 🔴 high
  - _Scenario:_ A fixture was locked with the wrong winner. An admin unlocks and fixes it, but by then group standings were shown, qualification computed, and possibly knockout fixtures generated off the wrong result. The fix must recompute points, shot difference, head-to-head, re-derive qualifiers, and flag now-invalid downstream knockout fixtures.
  - _Handling:_ Make standings/qualification derived (recomputed from results), never snapshotted, so a corrected score auto-updates rankings. For knockout fixtures already generated off a now-changed result, detect the inconsistency and warn the admin to regenerate/repair that round rather than leaving stale pairings. Log who changed what.
  - _Test:_ Lock a fixture with the wrong winner, let standings/qualification compute, then admin-correct the score; assert the group standings, qualifying-zone highlight, and head-to-head tiebreak all reflect the correction, and any dependent knockout fixture is flagged as needing regeneration.
- **Abandoned game (weather/injury) mid-ends has no valid state** — 🔴 high
  - _Scenario:_ A game stops after end 1 due to rain or injury. There's a partial score but the game isn't complete under the '2 ends then decider' rule. With no 'abandoned' state it stays incomplete-forever (blocking standings/schedule) or someone force-submits a partial score that ranking treats as a full result.
  - _Handling:_ Add an explicit admin 'abandon fixture' resolution with options: void (no points, no shots), award on current score, or replay later. The chosen outcome must be an intentional, labelled state distinct from a normal result so standings and the big-screen view show it honestly.
  - _Test:_ Abandon a fixture after 1 of the expected ends; assert it leaves 'in progress', its contribution to standings matches the chosen resolution exactly, and the standings/big-screen view labels it as abandoned rather than a played result.
- **Admin unlock races a stale player re-submit that clobbers the fix** — 🔴 high
  - _Scenario:_ An admin unlocks to correct a mistyped 21-2 to 12-2. Meanwhile the original submitter's phone still shows the fixture as theirs (missed the relock realtime frame) and taps Submit again with the old 21-2, landing after the admin's corrected write.
  - _Handling:_ Version the row (row_version or updated_at guard). Every write carries the version it read; the DB rejects a stale-version write ('this score changed, reload'). Admin corrections bump the version and are attributed (edited_by=admin); a player submit is accepted only when the fixture is in an unlocked state the player is entitled to fill.
  - _Test:_ Load the fixture on a player client (capture v1). Admin unlocks and writes a corrected score (v2). Player submits using v1; assert the player write is rejected with a conflict, the stored score is the admin's value, and edited_by/last-writer reflects the admin.
- **Double-submit from a timed-out request on poor signal** — 🔴 high
  - _Scenario:_ Weak signal: the submit request reaches Supabase and commits but the response is lost, so the app shows an error. The player taps Submit again, producing two identical writes, a duplicate per-end row, or a second submit racing the lock it itself created.
  - _Handling:_ Make submits idempotent: the client generates a submission UUID per attempt; the DB has unique constraints on (fixture_id, end_number) and on the idempotency key. A retry with the same key is a no-op returning the existing result, shown as 'already recorded' rather than an error.
  - _Test:_ Submit an end with idempotency key K, replay the identical request with K; assert the second call returns success referencing the same row and the count of end rows for that (fixture, end) is exactly 1. Submit a genuinely different end with a new key and assert it is accepted.
- **Implausible or impossible shot counts per end** — 🟠 medium
  - _Scenario:_ A pairs end (2 bowls each) scores at most 4 shots and only one team scores per end. Someone enters 15 shots, negative shots, or both teams scoring >0 on the same end. Bad per-end data silently corrupts shots-for and shot-difference tiebreakers.
  - _Handling:_ Server-side validate each end: exactly one team scores (other is 0), shots are an integer between 0 and the format max (4 for pairs), reject entries where both have >0. Make the max configurable for other formats. Surface a clear inline error, never silently clamp.
  - _Test:_ Submit an end where both teams score >0, and separately one with 15 shots; assert both are rejected with a validation error and no end row is persisted, while a legitimate 4-0 end is accepted.
- **Fixture locked before the game is actually finished** — 🟠 medium
  - _Scenario:_ 'First submit locks it', but a player might submit after only 1 end (mis-tap 'finish') or submit a full-looking 2-end score while the game continues. The lock then blocks the other team from entering the true result and standings update off a premature score.
  - _Handling:_ Only allow lock/submit when the game is rule-complete (2 ends decided, or a decider present with a winner). Warn 'game not complete - N ends entered' on an early finalize. Keep easy admin unlock and make a just-locked fixture obvious to both teams via realtime so a premature lock is caught immediately.
  - _Test:_ Attempt to submit/lock a fixture after entering only 1 end; assert it is not marked complete and doesn't contribute to standings, and that a valid 2-end (or decider) submission is required before the lock takes effect.
- **Repeated tied deciders with no cap or escalation** — 🟠 medium
  - _Scenario:_ Teams keep tying decider ends, genuinely or by mis-entry, and the app accepts a 3rd, 4th, 5th decider. On a one-day schedule this blows the running order and a stuck pair accumulates many end rows with no defined cap.
  - _Handling:_ Allow multiple deciders but surface a warning after N (e.g. 2) consecutive tied deciders prompting admin attention, and cap stored ends per fixture at a sane maximum. Give admins a one-tap 'resolve by toss/decision' override that closes the fixture with a recorded reason.
  - _Test:_ Enter 3 consecutive tied decider ends; assert an admin-visible warning/flag is raised and the schedule/standings do not treat the fixture as complete until a winner exists.
- **Late score edit rewrites a finished/archived tournament silently** — 🟠 medium
  - _Scenario:_ A locked score is corrected after the tournament is effectively over or during awards voting. Since standings are derived, a late edit can retroactively change the knockout outcome, the winner, or player-award eligibility after people have voted or the result was announced.
  - _Handling:_ Once a tournament is ended/archived, gate score edits behind an explicit 'reopen tournament' admin action with a recorded reason and a visible 'result amended' marker, so a silent late edit can't rewrite a finished, announced outcome or already-cast votes without a trace.
  - _Test:_ Edit a locked score after the tournament is marked ended; assert the edit is blocked or requires an explicit reopen step, and the change is recorded/visible (amended marker + who/when) rather than silently altering the archived standings.

### Scheduling, rinks and knockout · 9

- **Knockout can't start because one group is still playing** — 🔴 high
  - _Scenario:_ Groups A/B/C finish but Group D drags out (a forced decider). QF slots need Group D's winner and runner-up, but the predetermined running order says QF1 starts at a fixed slot with unknown participants. The big-screen 'up next' shows blank/TBD or, worse, stale seeds.
  - _Handling:_ Model knockout slots as depending on group completion, not clock time. A knockout fixture is in a 'blocked/waiting on Group D' state, un-startable (score entry rejected) until its feeder groups are fully scored and ranked, and the running order shows 'waiting on Group D result' not a time. Give admin a manual 'these two are free, bring their game forward' override.
  - _Test:_ Fully score A/B/C but leave one Group D fixture unscored; assert every knockout fixture fed by Group D rejects score submission server-side while one fed only by A/B (if the bracket allows) is startable. Score the last Group D game and assert the dependent QF flips to ready with the correct two teams.
- **Live rink removal strands an in-progress or queued game** — 🔴 high
  - _Scenario:_ A rink is discovered unplayable so the admin drops from 5 rinks to 4. But Rink 5 has a game in progress with one end scored plus queued future fixtures. Naive removal deletes those fixtures, orphans the entered end scores, or leaves the running order pointing at a rink that no longer exists.
  - _Handling:_ Guard rink removal: block removing a rink with an in-progress game (or force moving/finishing it first), and on removal re-flow that rink's queued fixtures onto surviving rinks rather than dropping them. Preserve entered scores by moving the fixture, not recreating it. Show a confirmation summarising which fixtures will be reassigned.
  - _Test:_ Assign a fixture with one end scored to Rink 5 and queue two more there, then remove Rink 5; assert the partial end data is intact and the fixture now lives on a surviving rink, the two queued fixtures reappear in some surviving rink's order, and total scheduled game count is unchanged.
- **Live schedule override double-books a team on two rinks** — 🔴 high
  - _Scenario:_ The predetermined order guarantees no team plays two games at once, but an admin live override (reorder, bring forward, move to a freed rink) can place Team T on Rink 2 and Rink 4 in the same slot, or start a new game for T while its previous game is still unscored, physically impossible for two people.
  - _Handling:_ Validate any live schedule edit against the team-availability constraint and reject or warn before commit. The generator already satisfies this; guard the manual override path specifically, including preventing a team starting a new game while its previous game is in progress/unscored.
  - _Test:_ Via the override path, attempt to move a fixture so Team T is on two rinks in overlapping slots; assert the operation is rejected/flagged with a clear conflict message and the schedule is not committed with T double-booked.
- **Correcting a group score reseeds a bracket that already started** — 🔴 high
  - _Scenario:_ An admin corrects a group score and it flips the group ranking, changing who qualifies. But the knockout bracket was already generated from the old standings and some knockout games may already be played, so the bracket now contains the wrong teams.
  - _Handling:_ Define policy explicitly: if knockout has NOT started, a group edit triggers automatic re-seed of affected slots; if knockout HAS started, block silent reseeding and flag a conflict to the admin ('this correction changes qualifiers but QF1 is already played - resolve manually'). Never silently swap a team out from under a live knockout game.
  - _Test:_ Fill a group so Team P finishes 1st on shot difference, generate the knockout, then edit a score so Team Q outranks P; assert (knockout unstarted) the slot now holds Q, and separately (a knockout QF already scored) the system raises a conflict/flag rather than silently rewriting the live bracket.
- **Bye represented as a playable fixture leaves the team in limbo** — 🔴 high
  - _Scenario:_ An odd bracket size gives Team X a first-round bye into the semifinal. If a bye is modelled as a real fixture vs a phantom 'BYE' entry, someone could enter a score for the bye 'game' or the auto-advance could fail to fire, leaving X resolved-but-not-advanced; and a paused/reconnected Supabase can leave the bye half-applied.
  - _Handling:_ Represent a bye as an automatic zero-score advancement that is never a playable fixture: the bye team is placed directly into the next-round slot at generation time, no score-entry UI, no lock. Auto-advance must be idempotent and re-runnable so a reconnect can't leave a bye half-applied; the next opponent updates once the feeder game finishes.
  - _Test:_ Generate a bracket with exactly one bye; assert the bye team appears pre-placed in the next round, no fixture row for the bye accepts a score submission (server-side reject), and the bye team's next opponent updates correctly once the feeder QF is scored.
- **Adding a rink live doesn't rebalance the backlog** — 🟠 medium
  - _Scenario:_ Running behind, the admin adds a 6th rink mid-morning to parallelise. The predetermined order was computed for 5 rinks, so the new rink has no fixtures and sits empty while the others stay congested, silently defeating the point of adding it.
  - _Handling:_ Adding a rink should offer to pull not-yet-started fixtures forward onto it from the most-backed-up rinks, respecting that a team can't be double-booked in the same slot, and never auto-moving an in-progress or locked game. Make it preview-then-confirm so the host controls aggressiveness.
  - _Test:_ Saturate 4 rinks with a visible backlog of unstarted fixtures, add a 5th and accept the rebalance; assert the new rink receives at least one previously-queued fixture, no team is now assigned to two rinks in the same slot, and no already-started game moved.
- **Live projected finish diverges from reality** — 🟠 medium
  - _Scenario:_ The setup estimate (minutes/end x ends x fixtures / rinks) assumes games run to time, but real games overrun via forced decider ends, slow ends, and weather. By mid-afternoon actual pace is well behind but the app still shows the original projected finish, so nobody realises they'll run out of daylight until too late. A forced decider after a 1-1 tie makes a meaningful fraction of games 50% longer than the budgeted 2 ends, compounding on each rink.
  - _Handling:_ Track actual per-game/per-end durations as scores come in and surface a live projected finish that updates from real pace, budgeting an expected-ends factor above the nominal count for likely deciders. Reflow downstream fixtures on a rink when a game runs long rather than assuming fixed slots, and warn when projected finish crosses a host-set hard stop.
  - _Test:_ Feed end-score timestamps for early games at a pace materially slower than the estimate; assert the displayed projected finish moves later (reflecting observed pace) and crossing a configured hard-stop raises a warning. Separately, score a game 1-1 after two ends and assert the next fixture on that rink is shown starting after the prior game actually completes, not at the fixed slot.
- **Bye team's next slot scheduled before its opponent can be known** — 🟠 medium
  - _Scenario:_ A knockout bye means one team is idle while opponents play a full game plus possible decider. On the predetermined order the bye team's next slot may be fixed and could start before the feeder game finishes, creating an impossible timing or an unfair rest gap that the schedule treats as a zero-duration slot.
  - _Handling:_ When placing knockout byes into the running order, ensure the bye team's next fixture is scheduled after both possible opponents could finish, and flag any slot where a bye creates a >1-round rest gap so admins can rebalance. Don't treat a bye as a zero-duration slot.
  - _Test:_ Generate a knockout with at least one bye; assert the bye team's next match slot starts no earlier than the scheduled end of the latest feeder game determining its opponent (no zero/negative gap requiring the opponent to be known before their game finishes).
- **Rink override during knockout lets the final start before its semis feed it** — 🟠 medium
  - _Scenario:_ Knockout has fewer live games, so admins free rinks and manually route the final to the best rink for spectators. During routing a semifinal and the final can get their rink/slot assignments swapped or the final scheduled before both semis finish feeding it.
  - _Handling:_ Keep the feeder dependency independent of rink placement: moving the final to Rink 1 must not let it start before both semis are scored. Rink assignment (where) and readiness (whether it can start) are separate concerns.
  - _Test:_ Manually assign the final to a specific rink while one semifinal is unscored; assert the final is placed on that rink but remains un-startable (score entry rejected server-side) until both semis are scored, then becomes startable with the two correct finalists.

### Concurrency and data integrity · 4

- **Bracket generated from stale/partial or double-submitted standings** — 🔴 high
  - _Scenario:_ The last group fixture is submitted, possibly twice via double-submit, and the app auto-generates the knockout keeping winners apart with byes. If generation reads standings before a concurrent admin score-fix commits, or fires twice on a duplicated submit, two brackets or a wrong seeding result.
  - _Handling:_ Make bracket generation a single idempotent transaction gated on 'all group fixtures locked', reading standings and writing the bracket atomically, refusing to regenerate if a bracket exists (or requiring explicit admin 'regenerate'). A later group-score edit that changes qualification forces an explicit admin-confirmed regenerate, never a silent divergence.
  - _Test:_ Submit the final group fixture twice concurrently; assert exactly one bracket is created with the two winners on opposite halves. Then admin-edit a locked group score that flips a qualifier; assert the app blocks or surfaces a required regenerate and the regenerated bracket reflects the new standings.
- **Free-tier pause then a thundering herd of queued retries** — 🟠 medium
  - _Scenario:_ A long lunch/prizegiving gap pauses the free-tier project. On restart the first submits time out while the DB wakes, and several players who queued offline submits all retry at once against the same fixtures.
  - _Handling:_ The client keeps a durable offline outbox with per-submit idempotency keys, retries with backoff, and shows 'saving...' until confirmed. Combined with DB-side idempotency and the lock CAS the herd resolves deterministically. Optionally a keep-warm ping during the event and an admin banner when the DB is waking.
  - _Test:_ Queue N offline submits (mix of same- and different-fixture), bring the API up and flush concurrently; assert every distinct fixture ends with exactly one locked result, no duplicate end rows, retried duplicates are no-ops, and no submit is silently dropped.
- **Out-of-order realtime frames show a superseded score on the big screen** — 🟠 medium
  - _Scenario:_ The public big-screen view subscribes to realtime. A correction and the original submit arrive out of order, or a reconnect replays an old cached frame, so the projector shows 21-2 after it was corrected to 12-2, and standings/up-next reflect the wrong result.
  - _Handling:_ Render from a monotonic version/updated_at per fixture and ignore any incoming frame older than what is displayed; on reconnect, refetch the authoritative snapshot rather than trusting replayed events. Standings/up-next derive from the reconciled snapshot, not accumulated deltas.
  - _Test:_ Apply updates v1 then v2, deliver them to the big-screen client as v2 then v1; assert the display stays at v2. Simulate a drop/reconnect that replays v1; assert the view refetches and still shows v2, with standings matching v2.
- **Concurrent edits to two fixtures in a group corrupt tiebreak ordering** — 🟠 medium
  - _Scenario:_ Two admins (or an admin and a player) fix two different fixtures in the same group at once. If standings are a mutable denormalized table updated by deltas, they get recomputed from a mix of old and new values, momentarily or persistently mis-ordering the qualifying zone.
  - _Handling:_ Never store standings as a mutable delta-updated table; compute them deterministically from the current set of locked fixtures (a view or on-read computation) so any read reflects a consistent snapshot. If cached for the big screen, key the cache on a group-level version bumped by any fixture write.
  - _Test:_ Construct a group tied on points where shot-difference decides; apply two fixture edits concurrently that together flip which team qualifies. After both commit, read standings once and assert the order and qualifying-zone highlight match a from-scratch recompute over the final results, never an intermediate ordering.

### Awards and voting · 8

- **'Minus own' exclusion wrong for team vs individual awards** — 🔴 high
  - _Scenario:_ Team awards (best dressed, cutest couple) have team nominees; individual awards (bowl of the day, most British/Kiwi) have person nominees. If exclusion is written once for 'self' and reused, a player could vote for their own partner in an individual award, or the code excludes the wrong entity type for team awards and shows a player their own team as a nominee.
  - _Handling:_ Model exclusion per award type: individual awards exclude only the voter; team awards exclude the voter's entire team (self and partner). Decide explicitly whether voting for your own partner in an individual award is allowed.
  - _Test:_ As player A on team {A,B}, request nominees for 'cutest couple' and assert {A,B} is absent; for 'best dressed' assert {A,B} absent; for 'bowl of the day' assert A is absent and B's presence matches Matt's decision.
- **Illegal votes blocked in UI but not enforced server-side** — 🔴 high
  - _Scenario:_ Nominee lists are filtered client-side so a player never sees themselves/their team, but votes are cast via a Supabase call. A player or tester crafts a direct insert voting for their own team, or stacks both votes on one nominee. If RLS/constraints trust the filtered UI, the illegal vote lands and skews the tally.
  - _Handling:_ Enforce in the database: an RLS policy or CHECK/trigger rejecting a vote where nominee == voter (or voter's team for team awards), and a unique constraint on (voter, award, nominee) so both votes can't stack on one nominee. Return a clear error, not a silent drop.
  - _Test:_ Bypass the UI and POST a vote for the voter's own nominee, and separately a duplicate (voter,award,nominee); assert both are rejected server-side and the tally is unchanged, not just that the buttons were hidden.
- **Vote tie for the winner with no tie-break rule** — 🔴 high
  - _Scenario:_ Unlike group ranking, awards have no documented tie-break. Two teams tie on 'best dressed' at 6 votes each and the big-screen/prize table need one winner. With small vote counts ties are likely, not rare.
  - _Handling:_ Define behaviour before the day: declare co-winners (fine for a fun social award) or give the admin a manual tie-break button. Do NOT auto-pick by row order/created_at/alphabetical, which looks rigged. Display '(tie)' explicitly rather than silently showing one name.
  - _Test:_ Seed equal top vote counts for two nominees, close voting, and assert the result view surfaces both as tied (or prompts the admin) rather than rendering a single arbitrary winner.
- **Changing a vote must replace, not accumulate, the ballot** — 🔴 high
  - _Scenario:_ Votes are changeable until close. A player picks nominee X then changes their vote to Y. If change is insert-without-delete, X keeps the phantom vote and the voter effectively has 3 counted votes. Rapid double-taps on flaky signal can also double-submit the change, or the '2 different nominees' rule can be violated by swapping.
  - _Handling:_ Treat a player's votes for an award as a replaceable whole set (delete-then-insert in a transaction, or upsert keyed on voter/award) guarded by a unique (voter, award, nominee) constraint and a check rejecting a set of size >2, duplicate nominees, or a nominee equal to the voter's own team/self. Make it idempotent so a retried request doesn't add a duplicate; re-derive the tally from the votes table, never an incrementing counter.
  - _Test:_ Vote X, change to Y, recount from the votes table and assert exactly one vote from that voter exists pointing to Y (X shows zero); replay the change twice and assert the count is still one. Attempt {X,X} and {X,Y,Z} and assert both are rejected.
- **Vote lands exactly as admin closes voting** — 🟠 medium
  - _Scenario:_ Poor signal delays a player's final ballot as the admin taps 'close voting'. Ambiguous whether the arriving vote counts; the big-screen tally may show a number that then changes after 'closed', and two players see different open/closed states, undermining trust in the winner.
  - _Handling:_ Server is the source of truth: closing writes a single authoritative timestamp/flag, and the vote-write RPC checks it transactionally, rejecting any ballot committed after close with a clear 'voting has closed'. The winner is computed only from ballots committed before the close instant; decide and document the rule.
  - _Test:_ With voting closed server-side, submit a vote from a client that still believes voting is open; assert the server rejects it, the tally is unchanged and immutable across a reload, and the client surfaces the closed state.
- **'2 votes to 2 different nominees' — partial voting semantics** — 🟠 medium
  - _Scenario:_ The rule is 2 votes per award to 2 different nominees, changeable until close. Ambiguities: can a player cast only 1 vote and skip the second? Must both be used to count? Selecting the same nominee twice — blocked or silent no-op? During a rushed ceremony people half-vote across the 5 awards.
  - _Handling:_ Allow 0, 1, or 2 votes per award (don't coerce a second choice, especially with few nominees). Block selecting the same nominee for both slots with an inline message. The tally counts each cast vote once.
  - _Test:_ Cast exactly 1 vote for an award, close, and assert that nominee's tally incremented by 1 and the voter is recorded as having voted; separately attempt both votes on one nominee and assert the second is refused.
- **Award with fewer than 2 eligible nominees for a voter** — 🟠 medium
  - _Scenario:_ Small edition or late dropouts shrink the pool. For some voter/award combos only 1 valid nominee exists, so the voter literally cannot cast 2 different votes, yet a naive flow forces a 'pick your 2nd vote' step over an empty list.
  - _Handling:_ Compute the eligible pool per voter per award and cap required votes at pool size (if only 1 nominee, allow just 1). Never render a second-vote step with an empty list.
  - _Test:_ Construct a tournament where a voter has exactly 1 eligible nominee for an award; assert the UI lets them submit with a single vote and the server accepts it rather than erroring on the missing second vote.
- **Reopening voting after close and after the winner was shown** — 🟠 medium
  - _Scenario:_ An admin closes voting, the winner is announced on the big screen, then someone reopens because a nominee was missing. Open questions: are existing votes preserved or wiped? Can people now change a vote after seeing the live winner (strategic voting)? Does the big-screen winner revert to a live tally?
  - _Handling:_ Reopening should preserve existing votes and flip results back to a provisional/live state, clearing any 'final winner' banner. Restrict reopen to admin/owner and log it. Decide whether reopening is even desired vs a one-way close, since showing the winner then re-voting invites gaming.
  - _Test:_ Cast votes, close, reopen; assert previously-cast votes still count and the results view no longer shows a 'final' winner; then change a vote and assert the live tally updates.

## 3. Open decisions still needed

See [requirements.md §8](requirements.md#8-open-decisions-pending-host-input) (OD-1 … OD-8).

- **Resolved:** OD-1 (walkover 10–0), OD-2 (uneven groups allowed), OD-3 (build for patchy signal), OD-4 (block self only) — see [decisions.md](decisions.md) D-0005…D-0008.
- **Still on defaults (confirm later):** OD-5 vote ties, OD-6 team lock point, OD-7 owner recovery, OD-8 shot sanity cap.
