"use client";

import { useActionState, useState } from "react";
import {
  submitScore,
  unlockFixture,
  walkoverFixture,
  type ScoreState,
} from "../actions";
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
  const [reviewing, setReviewing] = useState(false);

  const totalA = ends.reduce((s, e) => s + (Number(e.shotsA) || 0), 0);
  const totalB = ends.reduce((s, e) => s + (Number(e.shotsB) || 0), 0);
  const level = totalA === totalB;
  const anyBlank = ends.some((e) => e.shotsA === "" || e.shotsB === "");

  const set = (i: number, side: "shotsA" | "shotsB", val: string) => {
    // Digits only — no letters (e.g. "e"), decimals or signs. Cap at 3 digits.
    const clean = val.replace(/\D/g, "").slice(0, 3);
    setReviewing(false);
    setEnds((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, [side]: clean } : e)),
    );
  };

  const payload = ends.map((e, i) => ({
    shotsA: Number(e.shotsA) || 0,
    shotsB: Number(e.shotsB) || 0,
    isDecider: i >= endsPerGame,
  }));

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!reviewing) {
          event.preventDefault();
          if (!anyBlank && !level) setReviewing(true);
        }
      }}
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
            pattern="[0-9]*"
            disabled={pending || reviewing}
            value={e.shotsA}
            onChange={(ev) => set(i, "shotsA", ev.target.value)}
            className="w-16 rounded-lg border border-black/10 px-2 py-2 text-center text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            disabled={pending || reviewing}
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
        <>
          {reviewing ? (
            <div className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Check before locking
                </p>
                <p className="mt-1 font-display text-xl font-bold text-amber-950">
                  {teamAName} {totalA} – {totalB} {teamBName}
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  {totalA > totalB ? teamAName : teamBName} will be recorded as
                  the winner.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setReviewing(false)}
                  className="min-h-11 rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-60"
                >
                  Go back
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="min-h-11 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {pending ? "Saving…" : "Confirm & lock"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={pending || anyBlank || level}
              onClick={() => setReviewing(true)}
              className="w-full rounded-lg bg-brand px-4 py-3 text-base font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
            >
              Review score
            </button>
          )}
        </>
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
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Reset this result? Its score will be cleared and must be entered again.",
          )
        ) {
          event.preventDefault();
        }
      }}
      className="mt-5 text-center"
    >
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

export function WalkoverButton({
  fixtureId,
  winnerTeamId,
  teamName,
}: {
  fixtureId: string;
  winnerTeamId: string;
  teamName: string;
}) {
  const [state, action, pending] = useActionState(
    walkoverFixture,
    {} as ScoreState,
  );
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Record a 10–0 walkover to ${teamName}? This locks the game.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="fixtureId" value={fixtureId} />
      <input type="hidden" name="winnerTeamId" value={winnerTeamId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg border border-black/10 px-3 py-2.5 text-sm font-medium hover:bg-black/[.03] disabled:opacity-60"
      >
        {pending ? "Saving…" : `Win to ${teamName}`}
      </button>
      {state.error && (
        <p role="alert" className="mt-1 max-w-52 text-xs text-red-800">
          {state.error}
        </p>
      )}
    </form>
  );
}
