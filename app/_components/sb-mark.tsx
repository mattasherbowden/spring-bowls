// The abbreviated Spring Bowls brand mark — "SB'26": B in pink (like the
// wordmark), '26 as a small green superscript. Drop in front of section titles.
export function SBMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`whitespace-nowrap font-display font-semibold ${className}`}
      aria-label="Spring Bowls 2026"
    >
      S<span className="text-pink">B</span>
      <span className="align-super text-[0.55em] font-bold text-brand">
        &rsquo;26
      </span>
    </span>
  );
}
