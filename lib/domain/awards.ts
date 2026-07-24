// The votable awards. "Grand Final Winner" is NOT here — it's decided by the
// bracket, not a vote, and is shown separately in the ceremony.
export type AwardKind = "team" | "player";

export type AwardDef = {
  key: string;
  title: string;
  emoji: string;
  kind: AwardKind;
  // player awards may be restricted to one nationality (uses the Brit/Kiwi flag)
  nationality?: "brit" | "kiwi";
  blurb: string;
  // pastel tint + matching ink for the award's chip
  tint: string;
  ink: string;
};

export const AWARDS: AwardDef[] = [
  {
    key: "best_dressed",
    title: "Best Dressed",
    emoji: "👑",
    kind: "team",
    blurb: "Sharpest whites on the green.",
    tint: "#fde6cf",
    ink: "#8a5a1f",
  },
  {
    key: "cutest_couple",
    title: "Cutest Couple",
    emoji: "💕",
    kind: "team",
    blurb: "The pairing that melts hearts.",
    tint: "#fbe0ea",
    ink: "#b03567",
  },
  {
    key: "bowl_of_the_day",
    title: "Bowl of the Day",
    emoji: "🎯",
    kind: "player",
    blurb: "The single best bowl anyone saw.",
    tint: "#fdeecb",
    ink: "#8a6400",
  },
  {
    key: "coolest_brit",
    title: "Coolest Brit",
    emoji: "🇬🇧",
    kind: "player",
    nationality: "brit",
    blurb: "Most gloriously British.",
    tint: "#fbe1e1",
    ink: "#a33d3d",
  },
  {
    key: "coolest_kiwi",
    title: "Coolest Kiwi",
    emoji: "🇳🇿",
    kind: "player",
    nationality: "kiwi",
    blurb: "Most gloriously Kiwi.",
    tint: "#e2f2e7",
    ink: "#26833f",
  },
];

export const AWARD_BY_KEY = new Map(AWARDS.map((a) => [a.key, a]));

export const VOTES_PER_AWARD = 2;
