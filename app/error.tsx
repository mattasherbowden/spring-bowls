"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <section className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
        <p className="text-4xl">📶</p>
        <h1 className="mt-3 font-display text-2xl font-semibold">
          Connection hiccup
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-foreground/70">
          We couldn&apos;t load the tournament just then. Nothing has been reset or
          deleted. Check your signal, wait a moment, and try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 min-h-11 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Try again
        </button>
        <Link
          href="/"
          className="mt-3 block text-sm font-medium text-brand hover:text-brand-dark"
        >
          Return home
        </Link>
      </section>
    </main>
  );
}
