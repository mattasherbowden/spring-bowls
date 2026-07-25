import "server-only";

type SupabaseErrorLike = { message: string } | null | undefined;

/**
 * Supabase queries return errors as values. Event-day pages must not turn those
 * errors into plausible-but-false empty/setup states.
 */
export function throwIfSupabaseError(
  error: SupabaseErrorLike,
  context: string,
): void {
  if (!error) return;
  console.error(`Supabase read failed (${context})`, error.message);
  throw new Error("Tournament data is temporarily unavailable.");
}

/** A missing session is the normal logged-out state, not a connection failure. */
export function throwIfAuthUnavailable(
  error: { message: string; code?: string } | null | undefined,
  context: string,
): void {
  if (!error) return;
  const detail = `${error.code ?? ""} ${error.message}`.toLowerCase();
  if (/auth session missing|session.*missing|session_not_found/.test(detail)) {
    return;
  }
  throwIfSupabaseError(error, context);
}
