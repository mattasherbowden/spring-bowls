"use client";

import { useActionState } from "react";
import { login, type AuthState } from "../actions";
import { Field, SubmitButton, ErrorNote } from "./form-bits";

const initial: AuthState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);

  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      <Field id="username" label="Username" type="text" username placeholder="e.g. will" />
      <Field id="password" label="Password" type="password" placeholder="••••••••" />
      <SubmitButton pending={pending}>
        {pending ? "Logging in…" : "Log in"}
      </SubmitButton>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
    </form>
  );
}
