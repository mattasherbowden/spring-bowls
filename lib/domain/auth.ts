const EMAIL_DOMAIN = "springbowls.local";

type AuthErrorLike = {
  status?: number;
  code?: string;
  message?: string;
};

/** Deterministic synthetic email used by the password-based Supabase login. */
export function syntheticEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

/** Give guests an actionable message without leaking whether an account exists. */
export function loginErrorMessage(error: AuthErrorLike): string {
  const detail = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (error.status === 429 || /rate.?limit|too many|over_request/.test(detail)) {
    return "Lots of people are signing in at once — wait a minute and try again. Your password is fine.";
  }
  if (
    (error.status != null && error.status >= 500) ||
    /network|fetch failed|timeout|temporar|unavailable/.test(detail)
  ) {
    return "We couldn't reach the server just then — check your signal and try again.";
  }
  return "That username and password do not match.";
}
