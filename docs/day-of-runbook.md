# Spring Bowls day-of runbook

Short version: keep two organisers signed in before guests arrive, carry a
printed schedule and login list, and never use **Replace test roster** on the
day.

## The day before

- Replace the rehearsal roster from **Teams & logins → Replace this test roster
  before the event**. Type `DELETE TEST ROSTER`, create the final tournament,
  add every final team, and only then generate the draw. This preserves the
  owner, helper accounts and event-page details while removing all test
  fixtures, scores, votes and player logins.
- Set **Fixtures go live at** to `13:00` in the tournament wizard. Generating
  the draw publishes a locked preview: players can log in, see their first and
  later games, browse their group and the full draw, but cannot enter a score,
  record a walkover or vote.
- Prefer doing the final roster on Friday. If Saturday-morning changes are
  unavoidable after publishing the preview, open **Teams & logins** and choose
  **Rename / replace** beside a team. This changes only the displayed player
  and team names: the same login, password, group and fixtures are preserved.
  Use it to change a withdrawn player to `TBA`, then change `TBA` to the
  replacement's name when known. It is available only while the published draw
  is still in preview and no score or vote exists.
- If a whole team must be added or removed, or the rink count changes, choose
  **Edit preview — teams or rinks** instead. This removes only the unpublished
  draw and photo assignments: every team, username and password is preserved.
  Correct, add or remove teams, save the available rink count, then publish the
  preview again. Players who visit during the edit see a clear updating
  message.
- **Edit preview** is deliberately unavailable after **Start tournament**, a
  score/walkover, or any vote. The database also serialises simultaneous
  Start/Edit taps, so exactly one can win and the other refuses safely.
- A double tap or retry while adding a team now reuses the same submission key,
  so it cannot create a duplicate team. If the first request is still finishing
  its logins, wait a moment rather than changing the names and creating a
  second copy.
- Enter full player names where known. Voting abbreviates them to first name and
  surname initial (for example, `Ben Cochrane` becomes `Ben C.`), with automatic
  full-name or team fallbacks if two abbreviated labels would still match.
- New player accounts use a unique nationality-themed password: a memorable
  British reference for a Brit and a New Zealand reference for a Kiwi.
- Deploy the latest `main` and confirm the deployment includes migration
  `0018_day_of_hardening.sql`, `0019_atomic_draw.sql`, and
  `0020_exclude_admin_nominees.sql` through
  `0029_preview_roster_corrections.sql`.
- Open `/api/warm` on the production domain. It should return `{"ok":true}`.
- In Supabase, confirm the project says **Active**. Free projects with too
  little database activity can pause after seven days; the app now makes a
  daily warm-up request, but this manual check is the final safety net. See
  [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).
- In Vercel → Settings → Cron Jobs, confirm `/api/warm` is registered. Hobby
  cron runs once daily and can fire anywhere in the selected hour; that is fine
  for keeping a database active. See
  [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- In Supabase → Authentication → Rate Limits, set the password sign-in limit
  comfortably above the guest count (60 is sensible for ~30 people plus
  retries). Sign-in now runs directly from each phone, but phones on the same
  venue Wi-Fi may still share one public IP. See
  [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).
- Sign in once as the owner, one standalone helper, and one normal player.
  Confirm the helper can open **Schedule & fix scores** and the player sees
  their team.
- On **Schedule**, confirm the organiser panel says **Draw checks passed**. It
  verifies every group pairing, time-wave/rink placement, team running order,
  and the knockout dependency graph. Do not start if it is red. If an exact
  qualification tie occurs later, the affected knockout places wait until an
  organiser records the bowl-off/drawn-lots order shown on that group.
- Read the progress line and confirm every rehearsal score has been reset. A
  non-zero completed count means the live tables and qualification have already
  started.
- Keep at least two organiser/helper phones signed in. This avoids making
  organiser access depend on a fresh login during the rush.
- Print or save a PDF of `/setup/logins` and `/schedule`. Keep those private:
  the login page contains every throwaway event password.
- Take a screenshot of the Supabase and Vercel project names so another trusted
  person can find the right dashboard if the host is busy.

## When guests arrive

- Keep the tournament in preview while people arrive and log in. Their pages
  prominently say **Fixtures go live at 1:00pm**, but the draw and group layout
  are already available.
- At 1:00pm, the owner presses **Start tournament — open fixtures & Bowl
  voting**. Confirm only when everyone is ready: score entry and Bowl of the
  Day voting open immediately. The other awards remain closed until the
  separate ceremony-voting control is used later.
- Ask guests to use mobile data for the first login if the venue Wi-Fi is
  crowded. Once signed in, either connection is fine.
- If login says lots of people are signing in, wait one minute rather than
  repeatedly tapping. The message distinguishes this from a wrong password.
- The home and schedule pages refresh automatically every 20–30 seconds. The
  small **refresh now** control forces an immediate update.
- An amber offline message means the displayed scores may be stale. Do not save
  a score until the phone reconnects.
- A **Connection hiccup** page means tournament data could not be loaded. It
  never means the event was reset; wait a moment and use **Try again**.

## Entering and correcting scores

- Either team can enter a result; the first valid submission wins. A racing
  second submission is rejected rather than overwriting it.
- Score entry now has a **Review score** step. Read both team names, the total
  and the stated winner aloud before choosing **Confirm & lock**.
- If the wrong score was entered, a helper opens the completed game, chooses
  **Reset score**, then enters it again. A stale reset cannot wipe a newer
  correction.
- Correct group scores before any knockout result is entered. Once knockout
  play has started, group scores are deliberately locked so a correction cannot
  silently rewrite teams in an already-played bracket. Likewise, an earlier
  knockout round cannot be reset after a later round has been played.
- Only record a walkover while the game is still unplayed. A stale walkover
  cannot replace a real score.
- If a write reports a signal/server error, read the current page before
  retrying. It may already have succeeded.

## Knockout and ceremony

- Bye slots are not games and no longer appear as impossible “up next”
  fixtures.
- The roster is locked once the draw is live. This prevents a late-added team
  from receiving a login but no fixtures. Before play starts, the owner may use
  **Rename / replace** for a direct substitution that preserves the draw, or
  **Edit preview** to return to setup and republish the whole draw when its
  structure must change.
- Walkovers count consistently in the tables and bracket.
- If all group scores are in but a knockout slot still says TBA, the owner taps
  **Refresh knockout** on the schedule. Any database failure is shown beside
  the control.
- Bowl of the Day is available while the other awards are still pending, so
  the post-score prompt works throughout play. Open all awards only when ready
  for ceremony voting. Closing voting freezes every award atomically, including
  Bowl of the Day, so an in-flight vote cannot slip into the final tally.
- Award ties are shown as co-winners; the app does not secretly choose one.
- The owner remains eligible for Bowl of the Day and every team award, but is
  visibly unavailable for Coolest Kiwi with the requested friendly message.
  Helpers retain normal award eligibility.

## Rules to agree before the first bowl

These are event-policy choices rather than safe assumptions for the software:

- **Score convention:** decide whether each row is a literal bowls end (normally
  only one side scores and there is a format-specific maximum) or an aggregate
  mini-game score. The app accepts 0–999 because the current data uses aggregate
  values, but it always shows a confirmation before locking.
- **Weather/injury:** decide whether an interrupted game is replayed, awarded on
  its current score, or treated as a walkover. The app intentionally does not
  guess; there is no automatic abandoned-game points rule.
- **Exact multi-team qualification tie:** the normal order is wins, shot
  difference, shots for, then head-to-head for a clean two-team tie. For a
  still-exact three-way tie, run a bowl-off or draw lots; the app pauses the
  affected knockout places and asks an organiser to record the full order.
- **No-show:** the implemented rule is a 10–0 walkover to the present team.
- **Running order:** call **Wave 1, Wave 2, …** from the schedule. “Group Round”
  describes round-robin logic and is not always the physical start wave.

## If the app is unavailable

1. Move immediately to the printed schedule and record every result on paper.
2. Do not ask everyone to hammer refresh; one organiser checks the dashboards.
3. If Supabase is paused, resume it from the Supabase dashboard.
4. When service returns, one helper enters the paper results in schedule order.
5. Never use **Replace test roster** as a recovery step. Its typed confirmation
   deliberately deletes the entire tournament and should only be used before
   the final event draw.

## Verified on 31 July 2026

- The generated draw is property-tested for 2–40 teams, group targets 3–5,
  top-one/top-two qualification, and 1–6 rinks. Bracket dependency properties
  are checked for every 2–16 qualifier field.
- 341 unit/property tests passed.
- TypeScript, ESLint, and the production build passed.
- Live Supabase smoke tests passed for player isolation, standalone helper
  access, fixture-write isolation, racing result locks, preview voting locks,
  preview reopening, roster/draw and rink/draw races, credential preservation,
  draw-preserving preview replacements, Photo Bomb edit races, and voting
  closure.
- Mobile browser checks passed at 390 px width for landing, login, helper home,
  schedule, score entry, and the locked tournament preview.
