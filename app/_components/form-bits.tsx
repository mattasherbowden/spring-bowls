"use client";

import type { ReactNode } from "react";

export function Field({
  id,
  label,
  type,
  placeholder,
  username,
  hint,
}: {
  id: string;
  label: string;
  type: "text" | "password";
  placeholder?: string;
  username?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        placeholder={placeholder}
        autoCapitalize={username ? "none" : undefined}
        autoCorrect={username ? "off" : undefined}
        spellCheck={username ? false : undefined}
        className="rounded-lg border border-black/10 bg-white px-3 py-2.5 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
      />
      {hint && <p className="text-xs text-foreground/50">{hint}</p>}
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 rounded-lg bg-brand px-4 py-2.5 text-base font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {children}
    </p>
  );
}
