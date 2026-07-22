# Decision log

Short records of "why we chose X" — lightweight ADRs. Newest first.

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
