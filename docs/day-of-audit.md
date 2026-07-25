# Day-of & multi-user audit — action list

Findings from a multi-agent audit (2026-07-25) focused on two risks: **~40 guests using the app simultaneously** on their phones, and **failures on the day** of the event (1 Aug 2026). Each item is written to be picked up cold by a coding agent.

**Ground rules for anyone working these:**

- Writes go through Next server actions (`"use server"`) using the **service-role admin client** (`lib/supabase/admin.ts`), which bypasses RLS; authorization happens **in the action**. Keep this pattern.
- After any change: `mise exec -- npm test`, `mise exec -- npm run typecheck`, `mise exec -- npm run build` must all pass. Add/adjust tests in `lib/domain/*.test.ts` for pure-logic changes.
- Migrations live in `supabase/migrations/` (next free number) and are applied with `mise exec -- node scripts/db.mjs <file>`.
- Priorities: **P1** = could break the event · **P2** = annoying/risky on the day · **P3** = low impact.

## Implementation update — 25 July 2026

The event-day hardening pass completed all five P1 items and also fixed the
previously-undetected standalone-helper RLS failure. It additionally addressed
the most consequential P2/P3 items: explicit write feedback for score resets,
walkovers, voting and Photo Bomb; guarded knockout writes; eliminated-player
copy; CRLF/timezone handling; atomic voting closure; correct vote-limit copy;
stable award keys/ties; automatic live refresh/offline feedback; and a tested
day-of runbook. Migration `0018_day_of_hardening.sql` was applied and verified
against the live Supabase project.

A second draw-integrity pass found and repaired a physical scheduling defect:
valid round-robin pairings could still assign one team to two rinks in the same
time wave when a logical round contained more games than rinks. The scheduler
now packs conflict-free waves, preserves each team’s round order, exposes a
live organiser audit for both group and knockout draws, and property-tests the
full 2–40 team / 1–6 rink configuration space. Existing live matchups, IDs and
scores were preserved while rink/order values were repacked. Migration
`0019_atomic_draw.sql` also makes initial group assignment + fixture creation +
the setup-to-live transition one all-or-nothing database transaction.

A final pre-event repair pass added transactional edit/remove controls while
the roster is still in setup, explicit organiser resolution for exact
qualification ties (affected knockout slots wait instead of silently using UUID
order), honest connection-failure screens, and a genuinely one-time,
database-rate-limited owner recovery code. These are migrations `0021`–`0023`.

---

## P1 — Could break the event

### 1. Bye matches are inserted as permanently-pending fixtures and hijack the bye team's "Up next"

- **Files:** `lib/server/knockout.ts:72-85`, `app/page.tsx` (PlayerHome up-next), `app/schedule/page.tsx`
- **Config-guaranteed:** the real setup (12 teams, 3 groups, advance=2 → 6 qualifiers) pads the bracket to 8 with **2 byes**. This *will* happen.

**Problem:** `resolveKnockout` inserts **every** bracket match as a fixture row, including bye matches where `m.a` or `m.b` is `null` (`team_b_source: null`, `status: "pending"`). `buildBracket` already advances the bye team into the next round via its group label, so the bye "match" is a phantom. Once the bye team's group finishes, that pending row gets a `team_a_id` and — because it's an unplayed fixture the team belongs to — becomes the team's **"Up next"** card that can never be played, and shows in the schedule as a real game.

**Trigger:** Group A finishes; the Group A winner's home screen shows an up-next card for a game against nobody, forever.

**Fix:** In `lib/server/knockout.ts`, filter out bye matches when building `rows`: only insert matches where `m.a !== null && m.b !== null`. Verify the semifinal still references the bye team by group label (it does — bracket routes byes by label, not `W:<id>`). Check that `app/schedule/page.tsx` and PlayerHome no longer render a phantom fixture.

**Acceptance:**
- [ ] No pending/scheduled knockout fixture ever has a null team source
- [ ] A group winner who gets a bye sees their semifinal (or "waiting for opponent"), never a match vs nobody
- [ ] Bracket still resolves correctly for 6 qualifiers → SF/Final; `bracket.test.ts` still passes
- [ ] tests/typecheck/build pass

---

### 2. Walkover results are excluded from the standings tables players see (ranks contradict actual qualification)

- **Files:** `app/page.tsx:480`, `app/schedule/page.tsx:132`

**Problem:** The group-standings input on both the player home and the schedule filters `f.status === "completed"` only. But `lib/server/knockout.ts:105,113` includes `"completed" || "walkover"` when deciding who qualifies. So if a team gets a walkover (the supported withdrawal path), the **displayed table** ignores it while the **bracket** counts it → players see ranks that disagree with who actually advances.

**Trigger:** A team withdraws; an admin records 10-0 walkovers for their remaining games. The group table on screen shows different positions than the knockout was seeded from.

**Fix:** In both `app/page.tsx:480` and `app/schedule/page.tsx:132`, change the filter to `(f.status === "completed" || f.status === "walkover")` to match `lib/server/knockout.ts:113`.

**Acceptance:**
- [ ] Group tables on home + schedule include walkover results (10-0)
- [ ] Displayed ranks match the qualifiers the bracket uses
- [ ] tests/typecheck/build pass

---

### 3. `walkoverFixture` has no open-status guard — a stale admin tab overwrites a real entered score with 10-0

- **File:** `app/fixture/actions.ts:211-253`

**Problem:** `walkoverFixture` reads the fixture selecting only `tournament_id, team_a_id, team_b_id` (never `status`) and updates `.eq("id", fixtureId)` with **no** `.in("status", OPEN)` guard, unlike `submitScore` (line ~114, threat T-02). It then deletes `fixture_end` rows and re-resolves the knockout unconditionally.

**Trigger:** A team is late; an admin has the fixture open with walkover buttons showing. The team arrives and plays; a player submits the real score (15-12), fixture → `completed`. The admin's stale tab still shows the buttons and taps "Win to X" → the real result is silently replaced with a 10-0 walkover, genuine end rows deleted, wrong team can advance.

**Fix:** Mirror `submitScore`'s compare-and-set: select `status`, add `.in("status", OPEN).select("id")` to the update, and bail (skip the `fixture_end` delete + `resolveKnockout`) when zero rows are affected. Combine with item #6 (return an error state) so the admin sees "this game already has a score".

**Acceptance:**
- [ ] Recording a walkover on an already-`completed`/`walkover` fixture is a no-op that reports "already scored"
- [ ] `fixture_end` rows and the bracket are untouched on that no-op
- [ ] Recording a walkover on an unplayed fixture still works (10-0, resolves knockout)
- [ ] tests/typecheck/build pass

---

### 4. Login shows "username and password do not match" on rate-limiting; all sign-ins share Vercel's IP bucket

- **File:** `app/actions.ts:43-52`

**Problem:** `login()` returns the generic wrong-password message for **every** `signInWithPassword` error, including `429 over_request_rate_limit` and network/5xx. Worse: because login is a *server action*, all sign-ins hit Supabase from **Vercel's egress IPs**, not each phone — so Supabase's default auth rate limit (~30 requests / 5 min / IP on `/token`) is shared by the whole room.

**Trigger:** 12:30, everyone logs in with their cards at once. Guest ~#31 gets a 429 and is told their **password is wrong** — they retry, burning more of the budget, and can't get in.

**Fix:** In `login()`, branch on the error before returning: for `error.status === 429` / `error.code === "over_request_rate_limit"` return "Lots of people are signing in at once — wait a minute and try again (your password is fine)"; treat network/5xx as a transient "couldn't reach the server, try again". Consider staggering guidance in the day-of instructions. Investigate raising the Supabase Auth rate limit for the event window (dashboard → Auth → Rate limits) and note it in `docs/`.

**Acceptance:**
- [ ] A 429 shows a clear "too many at once, wait" message, not "wrong password"
- [ ] Network/server errors show a distinct transient message
- [ ] Genuine wrong password still shows the original message
- [ ] Day-of runbook documents the Supabase auth rate-limit setting
- [ ] tests/typecheck/build pass

---

### 5. Nothing keeps the free-tier Supabase project awake — it can pause and take the whole app down on the morning

- **Files:** `vercel.json`, new `app/api/warm/route.ts`

**Problem:** Supabase free-tier projects **pause after ~7 days of inactivity**. Dev is wrapping up ~a week before the event; if the DB goes idle, the first guest to open the link at 12:15 hits a paused project and **every page dies** — even the logged-out landing queries the DB (`app/page.tsx` `event_settings` + `owner_exists`). `vercel.json` has no `crons`; there is no scheduled job anywhere.

**Fix:** Add a keep-warm cron. Create `app/api/warm/route.ts` that does a trivial read (`createAdminClient().from("tournament").select("id").limit(1)`) and returns 200, then add to `vercel.json`: `"crons": [{ "path": "/api/warm", "schedule": "0 8 * * *" }]`. (Vercel Hobby allows one daily cron; a daily ping is enough to prevent the 7-day pause.) Manually confirm the project is un-paused the day before, too.

**Acceptance:**
- [ ] `/api/warm` returns 200 and touches the DB
- [ ] `vercel.json` has a daily cron hitting it
- [ ] Documented in the day-of runbook to double-check the project is active the day before
- [ ] tests/typecheck/build pass

---

## P2 — Should fix (annoying or risky on the day)

### 6. Several server actions swallow DB errors and return `void` — taps that fail show nothing (or falsely "succeed")

- **Files:** `app/fixture/actions.ts` (`walkoverFixture` ~241, `unlockFixture` ~173), `app/awards/actions.ts` (`setVotingStatus` ~143), `app/setup/actions.ts` (`refreshKnockout` ~417, `saveEvent`), `app/photo/actions.ts` (`togglePhotoDone` ~26, `savePhotoEmail` ~52)

**Problem:** These actions never destructure `{ error }` from their `.update()/.insert()/.delete()`, then `revalidate`/`redirect` as if it worked. On a Supabase blip or wifi drop (likely on venue wifi through one NAT), the write fails and the user gets **no feedback** — the button just doesn't change, or they navigate away believing it saved. Concrete cases:

- `setVotingStatus`: owner taps "Open voting" at the ceremony, it fails silently, 30 guests then get "Voting isn't open".
- `togglePhotoDone` / `savePhotoEmail`: guest taps, nothing flips / email silently lost (they never get the album invite).
- `unlockFixture`: admin "Reset score" fails but redirects to the still-locked score (the `UnlockButton` already renders `state.error` — this path just never populates it).

**Fix:** Convert each to return a state object (`{ error?: string }`, mirroring `unlockFixture`/`submitScore`'s `ScoreState`), destructure `{ error }` (add `.select("id")` where a rows-affected check helps), and wire the forms via `useActionState` in small client components (pattern: `UnlockButton` in `app/fixture/[id]/_scoreform.tsx`). Only `redirect` on success.

**Acceptance:**
- [ ] Each listed action returns an error message on DB failure and it renders near the button
- [ ] Success still redirects/updates as before
- [ ] tests/typecheck/build pass

---

### 7. Also in those void actions: a dead/expired session makes the tap do literally nothing

- **Files:** same as #6 — the `if (!user) return;` guards (e.g. `app/fixture/actions.ts:208`, `app/awards/actions.ts:121`, `app/photo/actions.ts:15`)

**Problem:** When the session has expired (mid-afternoon, or after a rate-limited token refresh), `getUser()` returns null and the action silently `return`s — no error, no redirect.

**Fix:** Replace `if (!user) return;` with `if (!user) redirect("/");` in these actions (`redirect` from `next/navigation`). The home page shows the login form when logged out, giving an unambiguous "you're signed out" signal. (Do this as part of #6's rewrite where those actions become stateful.)

**Acceptance:**
- [ ] Tapping any of these while logged out sends the user to the login screen
- [ ] tests/typecheck/build pass

---

### 8. `resolveKnockout` discards every write error — the bracket can silently fail to fill

- **File:** `lib/server/knockout.ts:86` (insert), `:158-180` (Promise.all of updates)

**Problem:** The bracket-create `insert` and the slot-fill `update`s are Supabase builders whose `{ error }` is never checked (`Promise.all` of builders resolves even when individual writes error). Under the 40-user burst, a transient 5xx leaves a semifinal `TBC`, and the "Refresh knockout" remedy swallows the same failure again.

**Fix:** Destructure results. For the insert, check `error` but ignore `23505` (the unique-index race is expected). For the batch, `const results = await Promise.all(writes)` then `results.filter(r => r.error)`; surface a failed count so callers (`submitScore`, `refreshKnockout`) can report a problem.

**Acceptance:**
- [ ] A failed slot-fill is detectable by the caller (not silently swallowed)
- [ ] The unique-index race (23505) is still treated as benign
- [ ] tests/typecheck/build pass

---

### 9. Eliminated players are told "Your knockout game will appear here" forever

- **File:** `app/page.tsx:657-670` (PlayerHome no-upNext branch)

**Problem:** When a player's group games are done and they **didn't** qualify, the all-done card still says "…Your knockout game will appear here as soon as the groups finish." The groups have finished; no game is coming. With ~half the field eliminated, that's a lot of confused reloads.

**Fix:** In PlayerHome, detect elimination: knockout fixtures exist and at least one has started resolving (scheduled/completed) and none contains `teamId`. Show "That's your bowling done for the day — you finished {ordinal} in Group X. Enjoy the knockout & the ceremony!" instead. Keep the "waiting" copy only while the knockout is genuinely unresolved for this team.

**Acceptance:**
- [ ] An eliminated player sees a clear "you're done" message, not "your game will appear"
- [ ] A still-alive player awaiting a bracket slot still sees the waiting copy
- [ ] tests/typecheck/build pass

---

### 10. Schedule renders walkover games as still-to-be-played

- **File:** `app/schedule/page.tsx:369` (rink list), `:259` (knockout)

**Problem:** `const done = f.status === "completed"` (and the knockout equivalent) excludes `walkover`, so a walked-over game shows on the shared schedule as "Team A v Team B · Grp A · R2" with no score and no "✓ done" — teams later in that rink's order think a game ahead of them is still to be played.

**Fix:** Change both checks to `f.status === "completed" || f.status === "walkover"` so walkovers show their 10-0 and "✓ done".

**Acceptance:**
- [ ] Walked-over games show 10-0 + "✓ done" in the rink order and bracket
- [ ] tests/typecheck/build pass

---

### 11. `saveEvent` stores CRLF line endings → hydration mismatch on the landing and `/day`

- **File:** `app/setup/actions.ts` (`saveEvent`, details field); consumers `app/_components/event-info.tsx:16-24`, `app/page.tsx`

**Problem:** Browsers serialize textarea newlines as `\r\n`. Saving the event details stores `\r\n`, but the seed used `\n`. The section-splitter (`split(/\n\s*\n/)`) then leaves stray `\r`, and server vs client render can diverge → React hydration error for every guest opening `/` or `/day`.

**Fix:** In `saveEvent`, normalize before storing: `String(fd.get("details") ?? "").replace(/\r\n?/g, "\n").trim() || null`. Defensively strip `\r` in the EventInfo splitter too.

**Acceptance:**
- [ ] Saving details (even unchanged) never introduces `\r`
- [ ] No hydration warning on `/` or `/day` after an owner saves
- [ ] tests/typecheck/build pass

---

### 12. Event date/time is interpreted in the editing device's timezone, not London

- **File:** `app/setup/event/_form.tsx:39` (and `toLocalInput` 9-13); display is pinned to `Europe/London` in `app/page.tsx:40-59`

**Problem:** `new Date(dt).toISOString()` parses the timezone-less `datetime-local` string in the **device's** zone. If the owner edits from a device not on London time (or across a DST boundary), the stored instant is wrong while the landing page always renders in `Europe/London` → wrong displayed time/countdown.

**Fix:** Interpret the typed wall-clock as `Europe/London` when building the instant (compute the London offset for that date via `Intl.DateTimeFormat` with `timeZoneName: "longOffset"`, or a small helper), and use the same zone for `toLocalInput`.

**Acceptance:**
- [ ] Editing "12:30" from a non-London device stores/display "12:30pm" London
- [ ] tests/typecheck/build pass

---

### 13. `addTeam` double-submit duplicates the team (with suffixed logins); no way to delete a team

- **File:** `app/setup/actions.ts:141` (team insert), `:96-104` (`uniqueUsername`)

**Problem:** A double-tap / form repost during setup creates the team twice: run 2's `uniqueUsername` sees run 1's committed profiles and picks `will2`/`ben2`, so it succeeds with a duplicate team and a second set of logins. `disabled={pending}` only kicks in after a re-render. There's also no delete-team path to clean up.

**Fix:** Add an idempotency key — hidden client UUID in the builder form, stored in a new `team.submit_key` column with a unique index `(tournament_id, submit_key)`; treat a `23505` on insert as "already added → success". Consider adding a delete-team owner action for cleanup (guard: only before `generateSchedule`).

**Acceptance:**
- [ ] Double-submitting "Add team" creates exactly one team
- [ ] (Optional) owner can remove a team during setup
- [ ] tests/typecheck/build pass

---

### 14. Fixture writes (`unlockFixture`, `resolveKnockout` slot updates) are unconditional and lose data under concurrent edits

- **Files:** `app/fixture/actions.ts:173-185` (`unlockFixture`), `lib/server/knockout.ts:176-178`

**Problem:** `unlockFixture` resets a fixture with no guard on current status, so a racing unlock (helper 2's stale tab) wipes a freshly re-entered correct score and can orphan `fixture_end` rows. Similarly `resolveKnockout` pushes slot updates computed from a stale snapshot with no status precondition, so a fixture that completed between read and write can have its teams rewritten.

**Fix:** Make these compare-and-set. `unlockFixture`: update `.eq("id", fixtureId).in("status", ["completed","walkover"]).select("id")` (optionally also match the observed `locked_at` passed as a hidden field); bail if zero rows. `resolveKnockout` updates: add `.in("status", ["pending","scheduled"])` (and `.eq("status","pending")` for the pending→scheduled promotion) so a fixture that completed mid-run is left alone.

**Acceptance:**
- [ ] A stale unlock does not clobber a re-entered score
- [ ] A knockout fixture that completed mid-resolve is not silently rewritten
- [ ] tests/typecheck/build pass

---

### 15. `castVote`'s open-voting check is a TOCTOU vs `setVotingStatus` — votes can land after the owner closes voting

- **File:** `app/awards/actions.ts:29-38` (status read) then insert/delete after several round-trips

**Problem:** `castVote` reads `voting_status` once, then does nominee validation (round-trips) before writing. On slow 4G, in-flight votes commit **after** the owner closes voting, changing the tally the owner is about to read out.

**Fix:** Enforce at the DB where it's atomic: in `app.enforce_vote_limit` (and a matching `BEFORE DELETE` trigger, or fold both into one function) reject when `(select voting_status from tournament where id = NEW.tournament_id) <> 'open'` with a distinct errcode; map that error in `castVote` to "Voting has closed." Add the migration and apply it.

**Acceptance:**
- [ ] A vote insert/toggle after voting closes is rejected at the DB
- [ ] `castVote` shows "Voting has closed" for that case
- [ ] tests/typecheck/build pass

---

## P3 — Nice to fix (low impact)

### 16. Vote-limit copy says "both votes" even for the 5-vote Bowl of the Day
- **File:** `app/awards/actions.ts:103-106`; static copy `app/awards/page.tsx:300,312-313`
- **Fix:** Reuse award-aware wording (`You've used all ${award.votes} votes for ${award.title}…`) in the trigger-error branch; update the static "Two votes per award" copy to note Bowl of the Day gives five.

### 17. `savePhotoEmail` does no server-side validation (arbitrary/huge text stored; garbles the owner's copy-paste invite list)
- **File:** `app/photo/actions.ts:34-56`
- **Fix:** Reject > 254 chars or values failing a basic email pattern (return an `{ error }` state per #6); lowercase/trim before storing.

### 18. Migration 0015's one-off partner assignment is a plain random cycle (can pair team-mates; not mutual) for the pre-existing tournament
- **File:** `supabase/migrations/0015_photo.sql:17-30` vs `lib/domain/photo.ts`
- **Fix:** Add a "Reshuffle photo partners" owner action on `/setup/photo` that re-runs `assignPhotoPartners` for the active tournament (or a one-off `scripts/` runner). Only affects a tournament created before 0016; new tournaments already use the good algorithm in `generateSchedule`.

### 19. Award result/ceremony lists use display labels as React keys (duplicate-name guests collide)
- **Files:** `app/awards/results/page.tsx:126`, `app/awards/page.tsx:272`
- **Fix:** Thread the candidate `id` through `standings()`/`resultFor()` and key by `id`; optionally disambiguate duplicate display names.

### 20. Live-tally page crowns an arbitrary member of a tie with the 🏆
- **File:** `app/awards/results/page.tsx:78,128-131`
- **Fix:** Mark every row whose count equals the max (`> 0`), append "(tie)" when more than one — matching the tie handling in `app/awards/page.tsx:174-176`.

### 21. `submitScore` discards `fixture_end` delete/insert errors (per-end record can be silently lost)
- **File:** `app/fixture/actions.ts:120-129`
- **Fix:** Destructure `{ error }` from the insert and at minimum `console.error` with the fixture id; `fixture_end` is currently write-only so impact is low, but it'll bite any future end-by-end view.

### 22. `generateSchedule` discards group-label / photo-partner write errors (a partial failure builds a permanently wrong bracket)
- **File:** `app/setup/actions.ts:251-256, 288-295`
- **Fix:** Check each `group_label` update's error and roll back the `setup→live` claim on failure (like the existing `fErr` path) before inserting fixtures; surface a warning if photo-partner updates fail.

---

## Previously known / deferred (from the earlier audit)

### 23. Harden owner recovery: bigger entropy + rate-limit + one-time codes
- **File:** `app/actions.ts` (`makeRecoveryCode`, `recoverPassword`)
- Recovery code space is ~900k, unauthenticated redemption has no rate limit/lockout, hash is unsalted SHA-256. Increase entropy to ≥64 bits, lock after ~5 failed attempts per username (needs a migration for attempt tracking), invalidate a code after one use.

### 24. `resetTournament` orphans auth users when a delete fails
- **File:** `app/setup/actions.ts` (`resetTournament`), `lib/supabase/auth-admin.ts` (`deleteAuthUser` returns void)
- Make `deleteAuthUser` report success/failure; collect and surface failures to the owner instead of silently leaving orphaned auth accounts.

### 25. `scripts/db.mjs` has no migrations tracking table
- **File:** `scripts/db.mjs`
- Add a `schema_migrations` table + apply-in-order + skip-already-applied, and wrap each file in `BEGIN/COMMIT`, so a fresh re-apply is safe and ordered.

---

_Generated from a 5-dimension multi-agent audit (concurrency, silent failures, auth/scale, newest code, day-of flow). The P1 config-triggered items (#1, #2, #3, #4, #5) were spot-verified against the code by hand; the rest carry exact file:line evidence from the finder agents. Re-verify each against current code before implementing._
