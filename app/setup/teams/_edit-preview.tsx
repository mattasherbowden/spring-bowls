"use client";

import { useActionState } from "react";
import {
  reopenPreviewForEditing,
  type PreviewEditState,
} from "../actions";
import { ErrorNote } from "../../_components/form-bits";

export function EditPreviewButton({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const [state, action, pending] = useActionState(
    reopenPreviewForEditing,
    {} as PreviewEditState,
  );

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Edit this preview? The current group and knockout draw will be removed. Teams, usernames and passwords are kept. Players will see an updating message until you publish the new preview.",
          )
        ) {
          event.preventDefault();
        }
      }}
      className="space-y-2"
    >
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg border border-brand/30 bg-white px-4 py-2.5 text-sm font-semibold text-brand-dark hover:bg-brand/5 disabled:opacity-60"
      >
        {pending ? "Opening the roster…" : "Edit preview — teams or rinks"}
      </button>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
    </form>
  );
}
