"use client";

import { useActionState } from "react";
import { recoverPassword, type RecoveryState } from "../actions";
import { Field, SubmitButton, ErrorNote } from "../_components/form-bits";

export function RecoverForm() {
  const [state, action, pending] = useActionState(
    recoverPassword,
    {} as RecoveryState,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field id="username" label="Username" type="text" username placeholder="e.g. matt" />
      <Field
        id="code"
        label="Recovery code"
        type="text"
        username
        placeholder="e.g. green-jack-4821"
      />
      <Field
        id="password"
        label="New password"
        type="password"
        placeholder="at least 8 characters"
      />
      <SubmitButton pending={pending}>Reset password</SubmitButton>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
    </form>
  );
}
