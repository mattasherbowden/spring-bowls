import "server-only";

// Create/delete auth users by calling the GoTrue admin REST endpoint directly.
// We avoid supabase-js `auth.admin.createUser` because that path rejects the new
// `sb_secret_` key against this project's ES256 JWT signing keys, whereas the
// REST endpoint accepts it (verified against the live project).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminHeaders(): Record<string, string> {
  return {
    apikey: SECRET,
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/json",
  };
}

export async function createAuthUser(
  email: string,
  password: string,
): Promise<{ id: string } | { error: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id) {
    const msg =
      body?.msg ??
      body?.error_description ??
      body?.message ??
      body?.error ??
      `HTTP ${res.status}`;
    return { error: String(msg) };
  }
  return { id: body.id as string };
}

export async function deleteAuthUser(id: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
}
