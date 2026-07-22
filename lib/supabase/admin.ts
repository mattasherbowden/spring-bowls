import "server-only";
import { createClient } from "@supabase/supabase-js";

// Admin client using the service_role key. BYPASSES Row Level Security, so it
// must ONLY ever run on the server (the "server-only" import above makes a
// client-side import fail the build). Used for owner/admin actions that create
// accounts, per decision D-0009 (no self-registration).
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
