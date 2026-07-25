"use client";

import { useActionState, useState } from "react";
import { castVote, type VoteState } from "./actions";
import type { AwardDef } from "@/lib/domain/awards";
import { ORGANISER_VOTE_MESSAGE } from "@/lib/domain/voting";

type Nominee = {
  id: string;
  label: string;
  count: number;
  organiser?: boolean;
};

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
  const [notice, setNotice] = useState<string | null>(null);
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
        {award.blurb} · pick up to {award.votes} ({picks.length}/{award.votes}{" "}
        used)
      </p>
      <form action={action} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="awardKey" value={award.key} />
        <input type="hidden" name="targetType" value={award.kind} />
        {nominees.map((n) => {
          const on = picked.has(n.id);
          if (n.organiser) {
            return (
              <button
                key={n.id}
                type="button"
                aria-disabled="true"
                onClick={() => setNotice(ORGANISER_VOTE_MESSAGE)}
                className="cursor-not-allowed rounded-full bg-black/[.03] px-3 py-1.5 text-sm text-foreground/45 opacity-70 ring-1 ring-black/5 transition hover:bg-black/[.05]"
              >
                {n.label}
              </button>
            );
          }
          return (
            <button
              key={n.id}
              name="targetId"
              value={n.id}
              disabled={pending}
              onClick={() => setNotice(null)}
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
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand-dark"
        >
          {notice}
        </p>
      )}
      {state.error && <p className="mt-2 text-sm text-red-800">{state.error}</p>}
    </section>
  );
}
