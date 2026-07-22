"use client";

import { useState } from "react";

export function LoginForm() {
  const [note, setNote] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNote(
      "Almost there — logins switch on once your tournament is set up. For now this is just the front door.",
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="username" className="text-sm font-medium">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="e.g. will"
          className="rounded-lg border border-black/10 bg-white px-3 py-2.5 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          className="rounded-lg border border-black/10 bg-white px-3 py-2.5 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>
      <button
        type="submit"
        className="mt-1 rounded-lg bg-brand px-4 py-2.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
      >
        Log in
      </button>
      {note && (
        <p
          role="status"
          className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand-dark"
        >
          {note}
        </p>
      )}
    </form>
  );
}
