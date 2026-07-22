# Edge cases & user-testing log

A living log of things that can go wrong, ambiguous rules, and what to probe during user testing. Each item aims to become a test (see [test-strategy.md](test-strategy.md)) or a resolved decision (see [decisions.md](decisions.md)).

> **Status:** an automated multi-lens edge-case sweep is running and will be merged into §2 with severities and test ideas. §1 below is the host-facing shortlist; §3 tracks decisions still needed.

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

**Security**
- Player crafts a direct API call to score another team's fixture or cast a 3rd vote → rejected by Row Level Security (tested, not assumed).
- Spectator (public view) tries any mutation → no path exists and the server refuses.

## 2. Consolidated catalogue (from automated sweep)

_Pending — will be populated from the background analysis with severity + test idea per item._

## 3. Open decisions still needed

See [requirements.md §8](requirements.md#8-open-decisions-pending-host-input) (OD-1 … OD-8). Four are being asked directly now; the rest have working defaults and can be confirmed later.
