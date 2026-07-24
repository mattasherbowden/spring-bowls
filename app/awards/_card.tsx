"use client";

import { useActionState } from "react";
import { castVote, type VoteState } from "./actions";
import type { AwardDef } from "@/lib/domain/awards";

type Nominee = { id: string; label: string; count: number };

export function AwardCard({
  award,
  nominees,
  picks,
}: {
  award: AwardDef;
  nominees: Nominee[];
  picks: string[];
}) {
  const [state, action, pending] = useActionState(castVote, {} as VoteState);
  const picked = new Set(picks);

  return (
    <section
      id={award.key}
      className="scroll-mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
    >
      <h3
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-base font-semibold"
        style={{ backgroundColor: award.tint, color: award.ink }}
      >
        {award.emoji} {award.title}
      </h3>
      <p className="mt-0.5 text-sm text-foreground/60">
        {award.blurb} · pick up to 2 ({picks.length}/2 used)
      </p>
      <form action={action} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="awardKey" value={award.key} />
        <input type="hidden" name="targetType" value={award.kind} />
        {nominees.map((n) => {
          const on = picked.has(n.id);
          return (
            <button
              key={n.id}
              name="targetId"
              value={n.id}
              disabled={pending}
              className={
                "rounded-full px-3 py-1.5 text-sm ring-1 transition disabled:opacity-60 " +
                (on
                  ? "bg-brand text-white ring-brand"
                  : "bg-white text-foreground ring-black/10 hover:bg-black/[.03]")
              }
            >
              {on ? "✓ " : ""}
              {n.label}
              {n.count > 0 && (
                <span className={on ? "text-white/80" : "text-foreground/40"}>
                  {" · "}
                  {n.count}
                </span>
              )}
            </button>
          );
        })}
        {nominees.length === 0 && (
          <p className="text-sm text-foreground/50">No eligible nominees.</p>
        )}
      </form>
      {state.error && <p className="mt-2 text-sm text-red-800">{state.error}</p>}
    </section>
  );
}
