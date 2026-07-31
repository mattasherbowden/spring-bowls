// Username suggestions and friendly password generation for player logins.
// suggestUsername is pure; generatePassword takes an injectable RNG so it is
// testable and deterministic under test.

const FALLBACK = "player";

/** Suggest a username from a display name: first word, lowercased, cleaned. */
export function suggestUsername(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  const cleaned = first.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const base = cleaned.length >= 2 ? cleaned : (cleaned + FALLBACK).slice(0, 8);
  return base.slice(0, 32);
}

const WORDS = [
  "jack",
  "rink",
  "bowl",
  "green",
  "spring",
  "draw",
  "woods",
  "ditch",
  "skip",
  "lead",
];

/** A short, friendly password like "green284" (min 6 chars). */
export function generatePassword(rand: () => number = Math.random): string {
  const word = WORDS[Math.floor(rand() * WORDS.length)] ?? "bowls";
  const num = String(Math.floor(rand() * 1000)).padStart(3, "0");
  return `${word}${num}`;
}

export type LoginNationality = "brit" | "kiwi";

// Public candidate pools, not assigned account credentials. They deliberately
// match the event's memorable-name theme; the server checks the database
// before assigning one and adds a suffix only if the whole pool is occupied.
const THEMED_PASSWORDS: Record<LoginNationality, readonly string[]> = {
  kiwi: [
    "edmundhillary1953",
    "jonahlomu11",
    "richiemccaw2011",
    "valerieadams2008",
    "peterjackson2001",
    "lorde2013",
    "taikawaititi2020",
    "jacindaardern2020",
    "brucemclaren1963",
    "katesheppard1893",
    "jeanbatten1936",
    "ernestrutherford1908",
    "temueramorrison1994",
    "crowdedhouse1986",
    "splitenz1972",
    "danielcarter10",
    "sophiepascoe2012",
    "stevenadams12",
    "lucylawless1995",
    "bretmckenzie2007",
    "martincrowe299",
    "lisacarrington2012",
    "damewhina1975",
    "neilfinn1986",
  ],
  brit: [
    "jamesbond007",
    "davidbeckham7",
    "queenelizabeth1952",
    "winstonchurchill1940",
    "timbernerslee1989",
    "adele21",
    "mofarah2012",
    "andymurray2013",
    "marypoppins1964",
    "davidbowie1972",
    "thebeatles1963",
    "paddington1958",
    "isaacnewton1687",
    "alanturing1936",
    "emmelinepankhurst1918",
    "maryanning1811",
    "shakespeare1599",
    "rogerbannister1954",
    "jessicaennis2012",
    "lewishamilton44",
    "freddiemercury1985",
    "eltonjohn1970",
    "viviennewestwood1971",
    "davidattenborough1954",
  ],
};

/** Return every themed candidate once, starting at an RNG-selected position. */
export function themedPasswordCandidates(
  nationality: LoginNationality,
  rand: () => number = Math.random,
): string[] {
  const pool = THEMED_PASSWORDS[nationality];
  const raw = Math.floor(rand() * pool.length);
  const start = Math.min(pool.length - 1, Math.max(0, raw));
  return [...pool.slice(start), ...pool.slice(0, start)];
}
