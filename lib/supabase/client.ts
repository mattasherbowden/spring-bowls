import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Safe to use in Client Components — it only
// ever uses the public anon key (never the service_role key).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
