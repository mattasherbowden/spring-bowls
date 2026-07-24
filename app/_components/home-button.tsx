import Link from "next/link";

// A big, obvious way back to the player's home (their games) from any screen.
export function HomeButton() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"
    >
      <span aria-hidden="true">←</span> Home
    </Link>
  );
}
