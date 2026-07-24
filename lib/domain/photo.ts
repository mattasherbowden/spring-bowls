type PhotoPlayer = { id: string; teamId: string | null };

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Assign each player a photo-bomb partner: mutual pairs (A <-> B), never
 * yourself, never your own team-mate. With an odd headcount, one player is
 * glued onto a pair (a one-way assignment for that single person).
 * Returns a map of playerId -> partnerId.
 */
export function assignPhotoPartners(
  players: PhotoPlayer[],
  rnd: () => number = Math.random,
): Map<string, string> {
  if (players.length < 2) return new Map();

  for (let attempt = 0; attempt < 300; attempt++) {
    const pool = shuffle(players, rnd);
    const used = new Set<string>();
    const map = new Map<string, string>();

    for (let i = 0; i < pool.length; i++) {
      if (used.has(pool[i].id)) continue;
      let partner: PhotoPlayer | undefined;
      for (let j = i + 1; j < pool.length; j++) {
        const c = pool[j];
        if (!used.has(c.id) && c.teamId !== pool[i].teamId) {
          partner = c;
          break;
        }
      }
      if (partner) {
        map.set(pool[i].id, partner.id);
        map.set(partner.id, pool[i].id);
        used.add(pool[i].id);
        used.add(partner.id);
      }
    }

    const leftover = pool.filter((p) => !used.has(p.id));
    if (leftover.length === 0) return map;
    if (leftover.length === 1) {
      const solo = leftover[0];
      const target = pool.find(
        (p) => used.has(p.id) && p.teamId !== solo.teamId,
      );
      if (target) {
        map.set(solo.id, target.id);
        return map;
      }
    }
    // otherwise reshuffle and try again
  }

  // Fallback (pathological input): a plain cycle — still never yourself.
  const pool = shuffle(players, rnd);
  const map = new Map<string, string>();
  for (let i = 0; i < pool.length; i++) {
    map.set(pool[i].id, pool[(i + 1) % pool.length].id);
  }
  return map;
}
