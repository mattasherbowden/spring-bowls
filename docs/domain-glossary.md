# Domain glossary & data model

Plain-English definitions so the code, tests, and docs all use words the same way.

## Bowls terms

| Term | Meaning |
|---|---|
| **Rink** | A lane/strip of the green where one game is played. The venue provides a fixed number; it caps how many games run at once (3 rinks → 3 games → 6 teams playing). |
| **End** | One passage of play: both teams bowl toward the jack, shots are counted, then they play back the other way for the next end. |
| **Shot** | A point. On each end, only the team with bowl(s) closest to the jack scores — one shot per bowl closer than the opponent's nearest. So an end is typically e.g. "Team A 3, Team B 0". |
| **Jack** | The small target ball. (Not modelled — context only.) |
| **Game / fixture** | One match between two teams, played over a set number of ends (default 2). Winner = more total shots. |
| **Decider** | An extra single end played when teams are level after the set ends, because draws aren't allowed. Repeats until someone leads. |
| **Group (pool)** | A set of teams that all play each other once (round-robin). Top 1 or 2 advance. |
| **Knockout** | Single-elimination stage after groups: lose and you're out, up to the final. |
| **Bye** | A free pass to the next knockout round when the number of qualifiers isn't a clean bracket size. |
| **Walkover** | A fixture awarded because a team didn't show / withdrew. |
| **Shot difference** | Total shots for minus total shots against, across a team's group games. First numeric tiebreaker. |

## Entities

```
Tournament 1─* Group 1─* Team 1─* Player
Tournament 1─* Rink
Tournament 1─* Fixture *─1 Rink
Fixture *─2 Team           (the two competing teams)
Fixture 1─* End            (per-end shot scores; includes deciders)
Tournament 1─* Award 1─* Vote *─1 Player (voter)
```

| Entity | Key fields |
|---|---|
| **Tournament** | id, name, edition, status (setup/live/archived), rink_count, ends_per_game, mins_per_end, advancement (top1/top2), team_size, voting_open, owner_id |
| **Group** | id, tournament_id, name (A/B/…) |
| **Team** | id, tournament_id, group_id, display_name?, seed?, status (active/withdrawn) |
| **Player** | id, tournament_id, team_id, name, username, nationality (brit/kiwi), role (owner/admin/player) |
| **Fixture** | id, tournament_id, stage (group/knockout), round, rink_id, order_in_rink, team_a_id, team_b_id (nullable until resolved), status (pending/current/final/walkover/abandoned), locked_by, winner_team_id |
| **End** | id, fixture_id, index, is_decider, shots_a, shots_b |
| **Award** | id, tournament_id, name, description, type (team/individual), nationality_filter?, is_open |
| **Vote** | id, award_id, voter_player_id, nominee_team_id? / nominee_player_id?, created_at (2 rows max per voter per award, distinct nominees) |

> The exact schema will be finalised alongside the Supabase migrations; this is the shared mental model.
