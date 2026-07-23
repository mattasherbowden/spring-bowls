"use client";

import { useActionState } from "react";
import { createOwner, type AuthState } from "../actions";
import { Field, SubmitButton, ErrorNote } from "./form-bits";

const initial: AuthState = {};

export function CreateOwnerForm() {
  const [state, action, pending] = useActionState(createOwner, initial);

  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      <Field id="displayName" label="Your name" type="text" placeholder="e.g. Matt" />
      <Field
        id="username"
        label="Username"
        type="text"
        username
        placeholder="e.g. matt"
        hint="2–32 characters: letters, numbers, dot, dash or underscore."
      />
      <Field
        id="password"
        label="Password"
        type="password"
        placeholder="at least 8 characters"
      />
      <SubmitButton pending={pending}>
        {pending ? "Creating…" : "Create owner account"}
      </SubmitButton>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
    </form>
  );
}
