"use client";

import { useActionState, useState } from "react";
import { submitScore, unlockFixture, type ScoreState } from "../actions";
import { ErrorNote } from "../../_components/form-bits";

type EndInput = { shotsA: string; shotsB: string };

export function ScoreForm({
  fixtureId,
  endsPerGame,
  teamAName,
  teamBName,
}: {
  fixtureId: string;
  endsPerGame: number;
  teamAName: string;
  teamBName: string;
}) {
  const [ends, setEnds] = useState<EndInput[]>(() =>
    Array.from({ length: Math.max(1, endsPerGame) }, () => ({
      shotsA: "",
      shotsB: "",
    })),
  );
  const [state, action, pending] = useActionState(submitScore, {} as ScoreState);

  const totalA = ends.reduce((s, e) => s + (Number(e.shotsA) || 0), 0);
  const totalB = ends.reduce((s, e) => s + (Number(e.shotsB) || 0), 0);
  const level = totalA === totalB;
  const anyBlank = ends.some((e) => e.shotsA === "" || e.shotsB === "");

  const set = (i: number, side: "shotsA" | "shotsB", val: string) =>
    setEnds((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, [side]: val } : e)),
    );

  const payload = ends.map((e, i) => ({
    shotsA: Number(e.shotsA) || 0,
    shotsB: Number(e.shotsB) || 0,
    isDecider: i >= endsPerGame,
  }));

  return (
    <form
      action={action}
      className="mt-5 space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
    >
      <input type="hidden" name="fixtureId" value={fixtureId} />
      <input type="hidden" name="ends" value={JSON.stringify(payload)} />

      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-xs font-medium text-foreground/60">
        <span />
        <span className="w-16 text-center">{teamAName}</span>
        <span className="w-16 text-center">{teamBName}</span>
      </div>

      {ends.map((e, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_auto_auto] items-center gap-2"
        >
          <span className="text-sm font-medium">
            {i < endsPerGame ? `End ${i + 1}` : "Decider"}
          </span>
          <input
            inputMode="numeric"
            value={e.shotsA}
            onChange={(ev) => set(i, "shotsA", ev.target.value)}
            className="w-16 rounded-lg border border-black/10 px-2 py-2 text-center text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <input
            inputMode="numeric"
            value={e.shotsB}
            onChange={(ev) => set(i, "shotsB", ev.target.value)}
            className="w-16 rounded-lg border border-black/10 px-2 py-2 text-center text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
      ))}

      <div className="flex items-center justify-between border-t border-black/5 pt-3 text-sm font-medium">
        <span>Total</span>
        <span>
          {totalA} – {totalB}
        </span>
      </div>

      {!anyBlank && level ? (
        <div className="space-y-2">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Scores are level — you can&apos;t draw. Add a decider end.
          </p>
          <button
            type="button"
            onClick={() =>
              setEnds((prev) => [...prev, { shotsA: "", shotsB: "" }])
            }
            className="w-full rounded-lg border border-brand px-4 py-2.5 text-sm font-semibold text-brand-dark hover:bg-brand/5"
          >
            + Add a decider end
          </button>
        </div>
      ) : (
        <button
          type="submit"
          disabled={pending || anyBlank || level}
          className="w-full rounded-lg bg-brand px-4 py-3 text-base font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "Saving…" : "Submit score"}
        </button>
      )}
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
    </form>
  );
}

export function UnlockButton({ fixtureId }: { fixtureId: string }) {
  const [state, action, pending] = useActionState(
    unlockFixture,
    {} as ScoreState,
  );
  return (
    <form action={action} className="mt-5 text-center">
      <input type="hidden" name="fixtureId" value={fixtureId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
      >
        {pending ? "Resetting…" : "Reset score (admin) — clear it to re-enter"}
      </button>
      <p className="mt-1 text-xs text-foreground/50">
        Sets this game back to un-played so a player can enter it again.
      </p>
      {state.error && (
        <p className="mt-1 text-xs text-red-800">{state.error}</p>
      )}
    </form>
  );
}
