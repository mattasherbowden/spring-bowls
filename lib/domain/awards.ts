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
};

export const AWARDS: AwardDef[] = [
  {
    key: "best_dressed",
    title: "Best Dressed",
    emoji: "👑",
    kind: "team",
    blurb: "Sharpest whites on the green.",
  },
  {
    key: "cutest_couple",
    title: "Cutest Couple",
    emoji: "💕",
    kind: "team",
    blurb: "The pairing that melts hearts.",
  },
  {
    key: "bowl_of_the_day",
    title: "Bowl of the Day",
    emoji: "🎯",
    kind: "player",
    blurb: "The single best bowl anyone saw.",
  },
  {
    key: "coolest_brit",
    title: "Coolest Brit",
    emoji: "🇬🇧",
    kind: "player",
    nationality: "brit",
    blurb: "Most gloriously British.",
  },
  {
    key: "coolest_kiwi",
    title: "Coolest Kiwi",
    emoji: "🥝",
    kind: "player",
    nationality: "kiwi",
    blurb: "Most gloriously Kiwi.",
  },
];

export const AWARD_BY_KEY = new Map(AWARDS.map((a) => [a.key, a]));

export const VOTES_PER_AWARD = 2;
