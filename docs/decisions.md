# Decision log

Short records of "why we chose X" — lightweight ADRs. Newest first.

### D-0008 · Individual-award voting excludes only the voter (partner allowed)
- **Date:** 2026-07-22 · **Status:** accepted
- **Decision:** For individual awards (e.g. bowl of the day), a voter is blocked only from voting for themselves — they may vote for their own partner. Team awards still exclude the voter's whole team.
- **Why:** Fits "best individual bowl of the day"; simplest rule to explain; host's call.

### D-0007 · Build for patchy venue signal
- **Date:** 2026-07-22 · **Status:** accepted
- **Decision:** Score/vote submission uses optimistic UI with an explicit saved / not-saved-yet state and automatic retry; the app degrades to on-demand fetch if realtime drops.
- **Why:** Greens often have poor signal; a score lost mid-tap would be the worst possible day-of failure, so robustness is worth the extra work.

### D-0006 · Allow uneven group sizes
- **Date:** 2026-07-22 · **Status:** accepted
- **Decision:** Groups may differ in size by one, so some teams play one more/fewer group game. The wizard shows the fixtures-per-team spread; ranking normalises fairly.
- **Why:** Maximum flexibility for whatever number of teams turns up, without forcing byes or making teams wait around.

### D-0005 · Walkover = win with a configurable set score (default 10–0)
- **Date:** 2026-07-22 · **Status:** accepted
- **Decision:** A no-show/forfeit awards the present team a win with a configurable shot score (default 10–0), so it also affects shot-difference tiebreaks.
- **Why:** Comparable across the table and rewards turning up; host's choice.

### D-0004 · No draws; per-end entry forces a decider
- **Date:** 2026-07-22 · **Status:** accepted
- **Decision:** Games are won/lost only. Players enter each end's shots; if level after the configured ends, the app forces single-end deciders until someone leads. League points win=1/loss=0; shot totals feed tiebreaks.
- **Why:** Matches how the event is actually played and gives clean qualification. Per-end entry naturally detects the level-after-N case.

### D-0003 · Predetermined schedule, not a dynamic queue
- **Date:** 2026-07-22 · **Status:** accepted
- **Decision:** Generate a fixed per-rink running order up front; the "live" behaviour just advances the pointer as scores finalise. Admin can override.
- **Why:** The host wants players to always know where they're up next. Predictability beats theoretical efficiency; also simpler and easier to test than a re-optimising queue.

### D-0002 · Username + password auth, no email/OAuth
- **Date:** 2026-07-22 · **Status:** accepted
- **Decision:** Accounts are username + password only. Supabase auth is fed a synthetic email behind the scenes so its email-based flows still work; users never see it. Owner is bootstrapped via a first-run screen.
- **Why:** Guests have mixed/unknown email providers and the host doesn't have everyone's email. Lowest friction for a one-day social event.
- **Trade-off:** No self-service email reset → admins reset passwords; owner gets a one-time recovery code (pending, OD-7).

### D-0001 · Stack: Next.js + Supabase + Vercel
- **Date:** 2026-07-22 · **Status:** accepted
- **Decision:** Next.js (App Router) + TypeScript + Tailwind, Supabase (Postgres + auth + realtime), deployed on Vercel.
- **Why:** Free tiers cover the whole thing; Supabase realtime powers the live "up next" screens with no polling; one well-trodden path with strong hot-reload for fast iteration. Domain logic kept framework-free for testability.
