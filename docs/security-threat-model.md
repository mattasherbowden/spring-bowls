# Security threat model (authorization)

Derived from an adversarial review of the database + Row Level Security design: **15 attack vectors** (4 high, 4 medium, 7 low). Each is a guard the schema/RLS MUST enforce and a behavioural test we MUST write (see [test-strategy.md](../test-strategy.md)). We build the database against this checklist and prove each item is blocked.


## High severity

### T-01 · Any participant can forge a decider end and steal the win on a live or completed fixture
- **Exploit:** A logged-in member of either team calls is_fixture_participant() = true forever — the fixture_end INSERT policy (fixture_end_insert_participant) has NO guard on fixture.status or fixture.locked_at. A player on the losing side simply INSERTs a row into fixture_end with is_decider=true and home_shots/away_shots set so their own team 'wins' (e.g. away team member inserts home_shots=0, away_shots=7, is_decider=true). The decider_not_level table CHECK is satisfied (0<>7). The AFTER INSERT trigger app.sync_fixture_from_ends() runs with definer rights, sees new.is_decider, and unconditionally sets fixture.status='completed', winner_team_id = (home_shots>away_shots ? home : away) = the attacker's team, and completed_at=now(). The real opponents never agreed to a decider and the game may not even be level. The attacker unilaterally decides the match result. This also works to OVERWRITE an already-'completed' fixture whose status was set by an earlier legitimate decider, because the trigger's status CASE only special-cases 'walkover' — any non-walkover status is force-set to 'completed' with the new (attacker) winner. The unique(fixture_id,end_number) index is the only limit, trivially avoided by picking an unused end_number.
- **Gap:** The claim 'participants get exactly one entry pass' and 'the first insert LOCKS the fixture' is not enforced anywhere. The INSERT policy permits unlimited participant inserts regardless of locked_at/status, and the trigger derives winner_team_id purely from an attacker-controlled is_decider row without verifying the game was actually level, that a decider was authorised, or that the fixture is still open.
- **Fix:**

```sql
Restrict participant inserts to open, not-yet-decided fixtures and forbid participant-authored deciders. Replace the INSERT policy with:

create policy fixture_end_insert_participant on fixture_end for insert to authenticated with check (
  app.is_admin(app.fixture_tournament(fixture_id))
  or (
    app.is_fixture_participant(fixture_id)
    and not is_decider
    and (select f.status in ('scheduled','live') from public.fixture f where f.id = fixture_id)
  )
);

and make the trigger authoritative about winners instead of trusting new.is_decider: only mark 'completed'/set winner via a decider row inserted by an admin, or compute completion from aggregate end totals server-side. E.g. guard the decider branch with a check that the fixture was actually level over regulation and that new.recorded_by belongs to an admin, or move decider creation entirely to an admin/service_role RPC.
```


### T-02 · Participant can keep appending ends after the score is locked, corrupting totals and standings
- **Exploit:** Even without forging a decider, once a fixture is 'live'/locked, a participant on either team can INSERT additional non-decider fixture_end rows (any unused end_number). The fixture_end INSERT policy only checks is_fixture_participant with no status/locked_at predicate, so the design's core promise — 'the first insert LOCKS the fixture; participants never mutate it again' — is false. app.sync_fixture_from_ends() re-sums ALL ends into fixture.home_shots/away_shots on every insert, so a losing player inflates their own team's shots (e.g. insert end with away_shots=99), directly changing the denormalised totals that feed group ranking (shot difference, shots-for) shown on the public standings. No admin unlock is required.
- **Gap:** 'Locking' is only conceptual: locked_at is stamped but no policy consults it to block subsequent participant writes. Locking is claimed to make the fixture participant-immutable after the first insert; nothing implements that.
- **Fix:**

```sql
Gate participant inserts on the fixture not already being locked/decided. Simplest robust rule: participants may only insert when fixture.status='scheduled' (i.e. only the very first end), and every subsequent end must be an admin action OR go through a single-transaction server RPC that inserts the whole match at once. Concretely add to the WITH CHECK: and (select f.locked_at is null from public.fixture f where f.id = fixture_id) for the participant branch — combined with the trigger stamping locked_at on that first insert, this enforces the 'exactly one entry pass' the design describes. (If multi-end live entry is required, entry must instead be an admin/RPC-mediated flow, since per-end participant inserts cannot otherwise be bounded.)
```


### T-03 · Any fixture participant (incl. a demoted admin now a plain player) can lock, complete, and self-declare the winner of a fixture with no admin — the SECURITY DEFINER end-sync trigger bypasses the 'only admin/owner may mutate a locked fixture' rule
- **Exploit:** The score-lock rule is 'the first insert LOCKS the fixture; only admin/owner may UPDATE a locked fixture.' RLS enforces this only by making fixture UPDATE admin-only and never granting participants UPDATE on fixture. But fixture_end_insert_participant (lines 641-647) allows INSERT whenever app.is_fixture_participant(fixture_id) is true, with NO check on fixture.status or fixture.locked_at. The AFTER INSERT trigger app.sync_fixture_from_ends() (lines 678-732) runs SECURITY DEFINER and unconditionally UPDATEs the fixture: it stamps locked_at, advances status, and — critically — if the inserted row has is_decider=true it sets status='completed', winner_team_id, and completed_at based purely on that end's home_shots vs away_shots. So a losing participant can, entirely on their own, INSERT an end with is_decider=true and home_shots>away_shots (or vice-versa) and the trigger will mark the fixture COMPLETED with THEM as winner. No admin is ever involved, and the 'locked = admin-only mutation' guarantee is bypassed because the participant is mutating fixture state indirectly through the definer trigger. A demoted admin who is still a listed fixture participant retains full ability to decide match outcomes despite losing their role. is_fixture_participant only checks team membership, never role or fixture lifecycle state.
- **Gap:** fixture_end_insert_participant places no upper bound on inserts: there is no predicate that the fixture is still 'scheduled'/'live', no cap that a participant may only insert while the fixture is not yet completed, and no gate distinguishing a normal end from a decider end (which single-handedly ends the match and names a winner). The trigger trusts the inserted is_decider flag and shot values with definer rights, so RLS's admin-only fixture UPDATE is not actually the only path to mutate locked/completed fixture state.
- **Fix:**

```sql
Constrain the participant INSERT branch to non-terminal, non-decider ends only, and force deciders/completion through admin. Split the policy:

  create policy fixture_end_insert_participant
    on fixture_end for insert to authenticated
    with check (
      app.is_admin(app.fixture_tournament(fixture_id))
      or (
        app.is_fixture_participant(fixture_id)
        and not new.is_decider
        and (select f.status from public.fixture f where f.id = fixture_id)
              in ('scheduled','live')
      )
    );

and make the trigger authorize decider/completion writes: in app.sync_fixture_from_ends(), when new.is_decider is true, raise 42501 unless app.is_admin((select tournament_id from public.fixture where id = new.fixture_id)) — so a level-breaking decider that completes the match can only be recorded by an admin/owner, and a participant can never mutate a fixture that is already 'completed'/'walkover'.
```


### T-04 · anon can reconstruct every player's login email from player.id leaked by v_public_player
- **Exploit:** v_public_player (lines 883-886) is granted SELECT to anon and exposes p.id. Per the AUTH design, player.id IS the 'stable id' and the synthetic login email is a pure deterministic function of it: syntheticEmail(id) = 'u_' || replace(id::text,'-','') || '@' || domain, where domain defaults to the fixed 'accounts.springbowls.invalid'. So any anonymous big-screen viewer runs `select id from v_public_player`, applies the public formula, and obtains the exact Supabase auth email for every account in the tournament. Login is signInWithPassword({email, password}); the email is the account identifier / one half of the credential and the whole reason the design 'never derives the email from the username and never exposes credentials.' The leak converts auth to password-only and hands an attacker a complete, targeted account list for credential-stuffing / password spraying / auth-endpoint abuse against owner, admins, and players by name (display_name is in the same view row, so each guessable email is tied to a real person).
- **Gap:** The view's safety was reasoned about purely in terms of 'no username/user_id/canonical columns', but player.id was overlooked as sensitive. It is not PII in the ordinary sense, yet the AUTH layer makes it the sole secret input that derives the login email, so exposing it is equivalent to publishing every account's email address.
- **Fix:**

```sql
Do not expose player.id to anon. Change v_public_player to expose only display_name and a NON-derivable surrogate if a key is needed, e.g.: `create or replace view public.v_public_player with (security_barrier = true) as select md5(p.id::text || p.tournament_id::text) as public_ref, p.tournament_id, p.display_name from public.player p;`. Any client-side join key for the big screen must be an opaque value from which the synthetic email cannot be recomputed (a random per-row token column, or a salted hash), never the raw player.id. Alternatively, if the screen only needs award-winner names, drop v_public_player entirely and surface winners through the award row's display join done server-side.
```



## Medium severity

### T-05 · SECURITY DEFINER helper functions are EXECUTE-granted to anon, turning them into a PII/role oracle
- **Exploit:** Section 1 grants EXECUTE on ALL app.* functions to anon (grant execute on all functions in schema app to anon, authenticated). These functions are SECURITY DEFINER and bypass RLS. An anonymous big-screen client (or any unauthenticated request with the anon key) can call them as RPCs (Supabase exposes SECURITY DEFINER functions via PostgREST /rpc). While most return booleans about auth.uid() (null for anon), app.award_tournament, app.fixture_tournament, app.award_kind, app.award_voting_open, and especially app.vote_is_valid let anon probe cross-table facts that anon has NO base-table access to (player and team_member have no anon SELECT policy). app.vote_is_valid(award, voter, nominee_player, null) returns true/false depending on whether nominee_player exists in the award's tournament and, for team awards, whether voter is a member of a given team — i.e. anon can enumerate team_member relationships (who is on which team) that the design explicitly hides from anon (section 7). This is a PII/roster disclosure oracle for the exact data the model says anon must never reach.
- **Gap:** The blanket grant to anon contradicts the stated PII boundary ('anon never touches player or team_member'). SECURITY DEFINER functions reachable by anon are an RLS bypass surface; only the boolean auth-scoped helpers are safe for anon, and even those need not be exposed.
- **Fix:**

```sql
Do not grant EXECUTE on the cross-table helpers to anon. Revoke the blanket grant and grant only what each actor needs:

revoke execute on all functions in schema app from anon;
grant execute on all functions in schema app to authenticated;
-- expose to anon only the handful that are genuinely public and non-probing, if any.

Additionally, add search_path='' is already present but ensure these functions are not auto-exposed via PostgREST (schema app should not be in the exposed schemas list), so anon cannot call them as /rpc at all.
```


### T-06 · Voting-after-close is NOT prevented for ballots because the schema has no relationship between voting_open and the unique-slot cap — a voter who abstained during open voting can still be blocked, but the closed-window guard depends solely on award_voting_open being read at INSERT time, which admins can toggle open again after tallying
- **Exploit:** award_voting_open(p_award) reads a.voting_open live. The vote_insert_voter WITH CHECK correctly blocks INSERTs while closed. However there is no immutability/audit: an admin/owner (or a compromised admin session) can flip award.voting_open back to true after the count is announced, allowing post-hoc ballot injection that is indistinguishable from legitimate votes, and vote_delete_self_open lets that same voter retract-and-recast during the reopened window. Nothing records that voting was ever closed, and winner_player_id/winner_team_id on award are not frozen against the tally. This defeats 'NO votes once that award's voting is closed' as an integrity property.
- **Gap:** voting_open is a mutable boolean with no one-way latch and no tie between 'a winner has been set' and 'voting is permanently closed'. The rule is only enforced instantaneously, not durably.
- **Fix:**

```sql
Add a CHECK/trigger making voting_open a one-way latch once a winner is set: create trigger on award BEFORE UPDATE that raises if old.voting_open = false and new.voting_open = true and (old.winner_player_id is not null or old.winner_team_id is not null). Alternatively add closed_at timestamptz and forbid re-opening. Enforce in a trigger since RLS cannot compare OLD/NEW.
```


### T-07 · The owner can demote themselves (owner -> admin/player) via player_update_self / player_update_admin, leaving the tournament with ZERO owners and no RLS path to ever recreate one
- **Exploit:** guard_player_role_change() (lines 420-448) permits a role change when app.is_owner(old.tournament_id) is true, and only blocks setting new.role='owner'. It never blocks the owner from changing THEIR OWN role away from 'owner'. The owner satisfies is_owner, so an UPDATE setting their own role to 'admin' or 'player' passes the trigger, passes player_update_self (user_id = auth.uid()) and player_update_admin (is_admin includes owner), and passes the one_owner_per_tournament partial index (it only forbids a second owner, not zero owners). Result: the tournament now has no owner. Every owner-only capability — tournament_update_owner (status flips to live/archived, walkover/scoring config, ending the tournament) and any future role change (guard requires is_owner) — is now permanently unreachable for anyone except service_role. This is a lifecycle self-lockout: the tournament can never be ended/archived or have roles fixed through the app again. A malicious or fat-fingered admin cannot trigger it, but a confused owner can brick the edition, and there is no in-app recovery.
- **Gap:** The invariant is 'exactly one owner per tournament,' but the schema/RLS only enforce 'at most one' (partial unique index) and 'cannot mint owner via UPDATE' (trigger). Neither enforces 'at least one': the guard trigger allows an owner to strip their own owner role, with no check that another owner would remain.
- **Fix:**

```sql
In app.guard_player_role_change(), block demoting the last owner: after the existing checks add

  if old.role = 'owner' and new.role <> 'owner' then
    raise exception 'the tournament owner cannot be demoted; transfer ownership via service_role first'
      using errcode = '42501';
  end if;

This forces owner changeover to go through the deliberate service_role/RPC path (consistent with 'ownership transfer is a service_role op') and guarantees a live owner always exists.
```


### T-08 · Public views leak data from ALL editions including archived, and run as an RLS-bypassing owner with no tournament scoping
- **Exploit:** v_public_team, v_public_fixture and v_public_player (lines 867-886) have no WHERE clause and are deliberately non-security_invoker, so they execute with the view owner's rights and bypass base-table RLS and even FORCE ROW LEVEL SECURITY. If the migration is run as the Supabase default (the postgres/superuser role used by the SQL editor and most migration tooling), the owner bypasses RLS on every base table, so anon selecting from these views receives rows for every tournament that has ever existed — live, setup, and archived 'read-only' editions alike — not just the current public big-screen edition. Combined with the player.id leak above, an attacker harvests derivable login emails for every account across all past editions in one query, defeating the 'archived data is read-only and isolated per edition' boundary.
- **Gap:** The views encode no tenant/status filter and rely entirely on column selection for safety, but ownership-based RLS bypass means row scoping is also lost. The design assumed 'expose only non-PII columns' was sufficient without constraining WHICH rows (which tournaments) anon may see.
- **Fix:**

```sql
Scope the views to publicly-viewable editions and, ideally, keep them security_invoker with explicit anon SELECT policies rather than an owner bypass. Minimum fix: add a status filter, e.g. `... from public.team t join public.tournament tn on tn.id = t.tournament_id where tn.status = 'live';` (and equivalently for fixture/player). Better: make the views `with (security_invoker = true)` and add narrow anon SELECT policies on the base tables limited to live editions and non-PII use, so the row set is governed by RLS instead of the definer's superuser rights. Also ensure the migration is not owned by a BYPASSRLS/superuser role.
```



## Low severity

### T-09 · Public non-PII views run as owner and bypass RLS, but their SELECT grant plus base-table SELECT grants risk leaking rows the design assumes are hidden
- **Exploit:** v_public_player / v_public_team / v_public_fixture are deliberately non-security_invoker and owned by a privileged role, so they read past base-table RLS. They are correctly column-limited, so the immediate PII columns are omitted. However the same section leaves anon with a raw table-level SELECT grant on player? No — anon SELECT grant list in section 2 DOES include player (grant select on ... player ... to anon, authenticated). anon has the base-table SELECT *grant*; only the absence of an anon SELECT *policy* stops rows being returned. That is correct under RLS (default-deny). The residual risk is operational: if anyone later adds a permissive anon SELECT policy on player for any reason, the standing anon table grant means usernames/username_canonical become immediately readable. The grant is broader than the model needs and defeats defence-in-depth.
- **Gap:** anon is granted base-table SELECT on player and team_member even though the design intends anon to reach those only through the column-limited views. The protection rests solely on 'no anon SELECT policy exists', a single point of failure.
- **Fix:**

```sql
Remove player and team_member from the anon base-table SELECT grant so a future stray policy cannot leak PII:

revoke select on player, team_member from anon;

anon keeps SELECT only on the genuinely public tables (tournament, tournament_group, team, rink, fixture, fixture_end, award, vote-if-intended) plus the three views. This makes the PII boundary structural (grant-level) rather than dependent on policy absence.
```


### T-10 · Admin fixture UPDATE lacks a WITH CHECK guard against reassigning teams/winner to another tournament's entities
- **Exploit:** fixture_update_admin USING and WITH CHECK both assert app.is_admin(tournament_id), which re-checks admin on the NEW row's tournament_id. But an admin in tournament X can UPDATE a fixture and set winner_team_id / team_home_id / team_away_id to a team id belonging to a DIFFERENT tournament, because nothing verifies those team ids share the fixture's tournament_id (the schema has FKs to team(id) but not composite (id,tournament_id) FKs on the fixture team columns). winner_is_a_participant only checks winner equals home or away, so an admin could set both home and winner to a foreign team. This lets a tournament-X admin write results referencing tournament-Y teams, polluting Y's standings/knockout via shared team ids. It is an admin-only action so lower severity, but it violates tournament isolation which the design leans on for the 'admin-in-X is not admin-in-Y' guarantee.
- **Gap:** Tournament isolation is enforced for the actor (is_admin is tournament-scoped) but not for the team references the admin writes. WITH CHECK re-asserts admin-on-tournament but does not constrain that team_home_id/team_away_id/winner_team_id belong to the same tournament.
- **Fix:**

```sql
Add composite FKs so cross-tournament references are impossible at the schema level: give team a unique(id,tournament_id) and reference it from fixture:

alter table fixture add constraint fixture_home_same_tournament foreign key (team_home_id, tournament_id) references team(id, tournament_id);
alter table fixture add constraint fixture_away_same_tournament foreign key (team_away_id, tournament_id) references team(id, tournament_id);

(and similarly constrain winner_team_id). This makes the isolation structural regardless of RLS.
```


### T-11 · voter_player_id can be forged for any player in a DIFFERENT tournament, letting one user cast unlimited ballots as ghost voters
- **Exploit:** vote_insert_voter's WITH CHECK requires voter_player_id = app.current_player_id(app.award_tournament(award_id)). current_player_id(p_tournament) selects the caller's player row WHERE tournament_id = p_tournament. If the attacker holds a profile in tournament A but targets an award in tournament B where they have NO profile, current_player_id(B) returns NULL, and voter_player_id = NULL is NULL (not TRUE), so that path is blocked — good. BUT the deeper issue: the equality is the ONLY thing binding the ballot to the real caller. Because vote_is_valid never re-derives the voter from auth.uid(), and the schema's vote table lets voter_player_id reference ANY player globally, the entire anti-fraud model hinges on current_player_id returning exactly one row. current_player_id has no LIMIT 1 and no uniqueness guard beyond player's UNIQUE(user_id); that unique constraint saves it here, but the same helper is reused in vote_delete_self_open and vote_select_self. The real exploitable consequence is in combination with finding on award_voting_open below.
- **Gap:** The voter-identity binding is a single equality against a SECURITY DEFINER helper; there is no defense-in-depth (e.g. a BEFORE INSERT trigger asserting voter_player_id belongs to auth.uid()). Any future change that lets current_player_id return a row for the wrong tournament (or a NULL-swallowing edit) silently enables impersonation.
- **Fix:**

```sql
Add a BEFORE INSERT trigger on vote (SECURITY DEFINER) that hard-asserts voter_player_id maps to auth.uid(): raise if not exists(select 1 from player where id = new.voter_player_id and user_id = auth.uid()). Keep it independent of current_player_id so it is a true second control.
```


### T-12 · The own-team exclusion on team awards silently passes when the voter has no team_member row, and does not exclude the voter's PARTNER's separate votes — but concretely: a voter with zero team membership can vote for ANY team including one they are administratively associated with
- **Exploit:** In vote_is_valid team branch, the own-team block is: if exists(select 1 from team_member tm where tm.team_id = p_nominee_team and tm.player_id = p_voter) then return false. A player who has been created (D-0009) but not yet assigned to a team_member row has NO membership, so this exists() is always false and every team is a legal nominee — including, after the admin later assigns them, their own team retroactively (the vote row persists). More sharply, team_member uses one_team_per_player_per_tournament but a player legitimately on team X can still be nominated-for by anyone; the rule only protects against self-team voting, and it evaluates membership at INSERT time only. If team membership changes after a ballot is cast (admin re-rosters), a now-own-team vote remains valid in the table.
- **Gap:** Own-team validity is checked only at INSERT and only against current membership; there is no revalidation, and unassigned voters bypass it entirely. Ballots are not invalidated when roster changes make them own-team.
- **Fix:** Two parts: (1) require voting to open only after rosters are frozen (enforce team_member immutability once award.voting_open flips true for any team award in the tournament). (2) In vote_is_valid, additionally reject when the voter has no team_member row for a team award if business rules require team membership to vote, or add a trigger that deletes/invalidates votes whose nominee_team becomes the voter's team on any team_member insert.

### T-13 · A voter can exceed the '2 distinct nominees' rule by racing two concurrent INSERTs, or hold both slots then retract-and-recast to defeat distinctness under READ COMMITTED — the unique indexes are correct, so this is NOT actually exploitable; reporting as verified-safe
- **Exploit:** vote_one_per_slot UNIQUE(award_id, voter_player_id, ballot_slot) and vote_distinct_player_nominee / vote_distinct_team_nominee partial unique indexes are enforced by the storage layer and hold under concurrency (unique indexes serialize on the index tuple regardless of isolation level). Two concurrent INSERTs of slot 1 both succeeding is impossible; two INSERTs of the same nominee across slots 1 and 2 both succeeding is impossible. There is no gap here.
- **Gap:** None — the schema unique indexes durably enforce the cap and distinctness even under concurrent INSERT. Verified no bypass.
- **Fix:** No change needed. (Included only to document that the concurrency angle on the vote caps was checked and is sound.)

### T-14 · guard_player_role_change trusts old.tournament_id for the owner check while relying on a separate branch to make tournament_id immutable — but the immutability branch does not cover INSERT-time or cross-tenant reassignment ordering, and an admin can flip any non-role column on the owner's own profile row
- **Exploit:** player_update_admin (lines 410-414) grants an admin UPDATE on ANY player row in their tournament, gated only by app.is_admin(tournament_id) in USING and WITH CHECK. The guard trigger blocks role and identity-column changes, but nothing stops an admin from updating the OWNER's display_name (or, if the app ever adds mutable profile columns, those too). More importantly, the owner-check in the guard uses app.is_owner(old.tournament_id); this is correct for same-tenant edits, but because the WITH CHECK on player_update_admin evaluates is_admin against the ROW's tournament_id (which the trigger separately pins to old.tournament_id), the two layers must agree for the guarantee to hold. They do here, but the design leans entirely on the trigger for column-level authorization while the policy WITH CHECK re-asserts only tenant-scoped admin — so any column the guard trigger does not explicitly name is freely editable by an admin on any profile, including the owner's. Today the only sensitive columns (role, user_id, tournament_id) are covered, so this is latent rather than immediately exploitable for privilege escalation.
- **Gap:** Column-level write authorization for player is enforced by an allow-by-default trigger that enumerates forbidden changes (role, user_id, tournament_id) rather than a deny-by-default model. Any newly added sensitive column (or username changes, which the guard does not restrict) is automatically writable by any admin on any row, and self-editable by any player on their own row, with no policy update required.
- **Fix:**

```sql
Make the guard deny-by-default for sensitive columns and explicitly whitelist what each actor may change. At minimum extend the trigger to also freeze username/username_canonical unless the caller is admin:

  if (new.username is distinct from old.username
      or new.username_canonical is distinct from old.username_canonical)
     and not app.is_admin(old.tournament_id) then
    raise exception 'username is admin-managed' using errcode = '42501';
  end if;

and add a code-review rule that any future player column defaults to non-updatable in this trigger, so the escalation surface cannot silently grow.
```


### T-15 · Latent anon PII exposure: anon holds a base-table SELECT grant on player and team_member, saved only by the absence of a policy
- **Exploit:** Line 330 grants SELECT on player and team_member to anon. Today anon reads nothing because those two tables have no anon SELECT policy and RLS is forced (default-deny). But this is one accidental policy away from a full username/credential leak: any future 'quick fix' that adds a permissive anon SELECT policy to player (e.g. `using (true)` copied from the team/fixture policies that surround it) instantly exposes username and username_canonical to the public big screen — exactly the PII the model forbids. The surrounding tables all DO have `using(true)` anon SELECT policies, so a copy-paste mistake is highly likely, and there is no second line of defense once it happens.
- **Gap:** Defense-in-depth is violated: the grant is broader than intended and the only thing preventing the leak is the (easily-reversed) lack of a policy. The comment claims 'anon gets NO row access to player at all,' but the GRANT contradicts the intent.
- **Fix:**

```sql
Remove the grant so a stray policy can never take effect for anon: `revoke select on player, team_member from anon;` (keep the grant for authenticated). Then anon PII exposure requires BOTH a grant and a policy to be re-added, not just a policy.
```

