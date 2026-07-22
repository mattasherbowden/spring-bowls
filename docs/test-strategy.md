# Test strategy

Tests are a first-class requirement here, not an afterthought. The point of this doc is not just "we test" — it's how we stop tests from **cheating** (looking green while proving nothing). Read §3 before writing a single test.

## 1. Principles

1. **A test encodes a requirement, not the implementation.** Expected values come from the spec/maths done independently — never pasted from what the code happened to output.
2. **Every test must be able to fail.** If you can't describe the bug a test would catch, it isn't a test.
3. **Test behaviour and outcomes, not internals.** Assert on returned values, database state, and what the user sees — not on private fields or "was this function called".
4. **Real logic runs.** Pure domain logic (scheduling, standings, tiebreakers, vote counting) is exercised with real inputs and outputs — never mocked away.
5. **Authorization is proven, not assumed.** Security rules are tested against the real policy layer, not a stub that always says yes.
6. **Determinism.** No dependence on wall-clock time or randomness without injecting a seed/clock.

## 2. Levels & tools

| Level | Tool | Covers |
|---|---|---|
| Unit | **Vitest** | Pure domain functions: group generation, round-robin fixtures, standings + tiebreakers, decider logic, bracket + byes, schedule ordering, vote validation & tally, time estimator. |
| Component | **Vitest + React Testing Library** | Screens render correct state and disable/enable controls per role; queried by role/text, not test-ids-only. |
| Integration | **Vitest + Supabase local** | Server actions + DB round-trips: score lock, admin unlock/recompute, vote replace, tournament lifecycle. |
| Authorization | **Supabase RLS tests** (SQL/pgTAP or integration) | A player cannot submit another team's fixture; cannot cast a 3rd vote; cannot vote closed; spectator can't mutate. |
| End-to-end | **Playwright** | Full journeys: owner first-run → create tournament → player login → enter score (locks) → standings update → vote → close voting → ceremony. |
| Mutation | **Stryker Mutator** | Runs on the domain-logic modules to *prove the unit tests actually catch bugs* (see §4). |

The domain logic lives in framework-free TypeScript modules (`/lib/domain/*`) precisely so it can be unit-tested exhaustively without a browser or DB.

## 3. Anti-cheating rules (enforced in review)

Reject any test that does the following:

- ❌ **Tautologies:** `expect(true).toBe(true)`, `expect(x).toBe(x)`, or asserting a mock was called with the exact args you just fed it.
- ❌ **Snapshot-as-spec:** committing a snapshot/expected blob copied from current output without an independent reason it's correct. (Snapshots are allowed only for stable, human-reviewed markup — never for computed results.)
- ❌ **Mocking the unit under test** or its core collaborators so the real logic never runs (e.g. mocking the standings calculator inside a standings test).
- ❌ **Assertion-free tests** and `expect(fn).not.toThrow()` as the *only* assertion.
- ❌ **Authorization theatre:** asserting a button is hidden while never testing that the server rejects the action.
- ❌ **Skips in disguise:** `.skip`, `.only`, commented-out asserts, or `try/catch` that swallows a failure.
- ❌ **Non-deterministic passes:** relying on real `Date.now()`/`Math.random()`/network timing instead of injected clock/seed/fixtures.

Every meaningful test should carry a one-line comment or name stating **the bug it catches** (e.g. `FR-D3 · fails if shots-for is compared before shot-difference`).

## 4. Proving the tests aren't cheating

We don't take coverage on faith:

- **Mutation testing (Stryker)** runs against `/lib/domain`. If we flip a `>` to `>=`, swap tiebreak order, or drop a decider check and the suite still passes, that mutant "survived" → the tests are weak there and must be strengthened. Target: no surviving mutants on core scoring/standings/bracket logic.
- **Red-first for every bug:** a bug fix starts with a failing test that reproduces it, then the fix makes it green.
- **Coverage is a floor, not the goal:** branch coverage required on `/lib/domain`; but a green line without a real assertion counts for nothing — mutation score is the real signal.

## 5. Traceability

- Test names reference requirement IDs from [requirements.md](requirements.md) (`FR-*`, `NFR-*`).
- A generated matrix (script over test names) flags any FR with acceptance criteria and **zero** referencing tests — that gap fails CI.

## 6. What "done" means for a feature

A feature isn't done until:
1. Its FR acceptance criteria each have a real, failing-capable test.
2. Domain logic it touches has no surviving mutants.
3. At least one E2E path covers the happy path end to end.
4. The relevant authorization rule has a test that proves the server rejects the bad actor.

## 7. CI

GitHub Actions on every push/PR: `lint → typecheck → unit + integration → RLS → e2e → mutation (on domain) → traceability check`. Red blocks merge.
