"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, SubmitButton, ErrorNote } from "./form-bits";
import { createClient } from "@/lib/supabase/client";
import { loginErrorMessage, syntheticEmail } from "@/lib/domain/auth";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "");
    const password = String(form.get("password") ?? "");
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }

    setPending(true);
    setError(undefined);
    try {
      // Sign in from the phone, not a shared Vercel server IP. This prevents a
      // roomful of guests arriving together from sharing one Auth rate bucket.
      const { error: signInError } = await createClient().auth.signInWithPassword({
        email: syntheticEmail(username),
        password,
      });
      if (signInError) {
        setError(loginErrorMessage(signInError));
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(
        loginErrorMessage({
          message: caught instanceof Error ? caught.message : "network error",
        }),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
      <Field
        id="username"
        label="Username"
        type="text"
        username
        placeholder="e.g. will"
      />
      <Field id="password" label="Password" type="password" placeholder="••••••••" />
      <SubmitButton pending={pending}>
        {pending ? "Logging in…" : "Log in"}
      </SubmitButton>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Link
        href="/recover"
        className="text-center text-xs text-foreground/50 hover:text-foreground/70"
      >
        Forgot your password?
      </Link>
    </form>
  );
}
