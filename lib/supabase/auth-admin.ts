import "server-only";

// Create/delete/update auth users by calling the GoTrue admin REST endpoint
// directly. We avoid supabase-js `auth.admin.createUser` because that path
// rejects the new `sb_secret_` key against this project's ES256 JWT signing
// keys, whereas the REST endpoint accepts it.
//
// GoTrue also *intermittently* returns "invalid JWT ... unrecognized JWT kid
// <nil> for algorithm ES256" — a transient signing-key hiccup that succeeds on
// a retry — so every admin call retries with backoff before giving up.

// Trim defensively: a trailing newline/space pasted into a Vercel env var is a
// classic silent break (the key then fails to authenticate).
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SECRET = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

function adminHeaders(): Record<string, string> {
  return {
    apikey: SECRET,
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/json",
  };
}

// Prefix + length only (never the secret) — so a failing server can tell us
// whether it holds the new `sb_secret_…` key or the old `eyJ…` one.
function keyShape(): string {
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ws = raw !== raw.trim() ? " +whitespace" : "";
  return raw ? `${raw.trim().slice(0, 10)}… len ${raw.length}${ws}` : "MISSING";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Errors worth retrying: the ES256/JWT signing hiccup, plus any 5xx / network
// blip. A real error (e.g. duplicate email, 4xx) fails fast without retrying.
const TRANSIENT = /jwt|signature|unverifiable|unrecognized|kid|temporar|timeout|network|fetch failed/i;
const BACKOFF_MS = [400, 900, 1600]; // waits before attempts 2, 3, 4

type AdminResult = {
  ok: boolean;
  body: { id?: string } | null;
  status: number;
  msg: string;
};

async function adminFetch(
  path: string,
  method: string,
  payload?: unknown,
): Promise<AdminResult> {
  let lastMsg = "unknown error";
  let lastStatus = 0;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1]);
    let res: Response;
    try {
      res = await fetch(`${SUPABASE_URL}${path}`, {
        method,
        headers: adminHeaders(),
        body: payload ? JSON.stringify(payload) : undefined,
      });
    } catch (e) {
      lastMsg = e instanceof Error ? e.message : "network error";
      continue; // network errors are transient
    }
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, body, status: res.status, msg: "" };
    lastStatus = res.status;
    lastMsg = String(
      body?.msg ??
        body?.error_description ??
        body?.message ??
        body?.error ??
        `HTTP ${res.status}`,
    );
    if (!(res.status >= 500 || TRANSIENT.test(lastMsg))) {
      return { ok: false, body, status: res.status, msg: lastMsg };
    }
  }
  return { ok: false, body: null, status: lastStatus, msg: lastMsg };
}

export async function createAuthUser(
  email: string,
  password: string,
): Promise<{ id: string } | { error: string }> {
  const r = await adminFetch("/auth/v1/admin/users", "POST", {
    email,
    password,
    email_confirm: true,
  });
  if (r.ok && r.body?.id) return { id: r.body.id };
  return { error: `${r.msg || "could not create login"} [key ${keyShape()}]` };
}

export async function deleteAuthUser(id: string): Promise<boolean> {
  const r = await adminFetch(`/auth/v1/admin/users/${id}`, "DELETE");
  return r.ok;
}

export async function setAuthUserPassword(
  id: string,
  password: string,
): Promise<boolean> {
  const r = await adminFetch(`/auth/v1/admin/users/${id}`, "PUT", { password });
  return r.ok;
}
