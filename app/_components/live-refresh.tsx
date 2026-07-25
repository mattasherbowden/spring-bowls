"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh() {
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  const [refreshing, startTransition] = useTransition();

  const refresh = useCallback(
    () => startTransition(() => router.refresh()),
    [router],
  );

  useEffect(() => {
    const markOnline = () => setOffline(false);
    const markOffline = () => setOffline(true);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);

    // Defer state updates until after mount, keeping server/client HTML stable.
    const initialStatus = window.setTimeout(
      () => setOffline(!navigator.onLine),
      0,
    );
    let timer = 0;
    const schedule = () => {
      // Jitter prevents 30 phones from all refreshing on the same millisecond.
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible" && navigator.onLine) {
          refresh();
        }
        schedule();
      }, 20_000 + Math.random() * 10_000);
    };
    schedule();

    return () => {
      window.clearTimeout(initialStatus);
      window.clearTimeout(timer);
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, [refresh]);

  return offline ? (
    <p
      role="status"
      className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-900 ring-1 ring-amber-200"
    >
      You&apos;re offline — scores may be out of date. Reconnect before saving.
    </p>
  ) : (
    <div className="text-center">
      <button
        type="button"
        onClick={refresh}
        disabled={refreshing}
        className="text-xs font-medium text-foreground/50 hover:text-brand-dark disabled:opacity-60"
      >
        {refreshing ? "Refreshing…" : "Scores update automatically · refresh now"}
      </button>
    </div>
  );
}
