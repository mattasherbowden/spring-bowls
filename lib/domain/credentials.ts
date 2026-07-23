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
