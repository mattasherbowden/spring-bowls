"use client";

import { useEffect, useState } from "react";

function Unit({ n, label }: { n: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold tabular-nums text-brand-dark">{n}</div>
      <div className="text-xs uppercase tracking-wide text-foreground/50">
        {label}
      </div>
    </div>
  );
}

export function Countdown({ target }: { target: string }) {
  // Compute only after mount so the server render (which can't know "now")
  // never mismatches the client during hydration.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (nowMs === null) {
    return <p className="text-center text-sm text-foreground/40">…</p>;
  }

  const ms = new Date(target).getTime() - nowMs;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) {
    return (
      <p className="text-center text-lg font-semibold text-brand-dark">
        It&apos;s on — see you on the green! 🎉
      </p>
    );
  }

  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);

  return (
    <div className="flex items-start justify-center gap-4">
      {d > 0 && <Unit n={d} label="days" />}
      <Unit n={h} label="hrs" />
      <Unit n={m} label="min" />
      {d === 0 && <Unit n={s} label="sec" />}
    </div>
  );
}
