import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HelperManager } from "./_manager";

export default async function HelpersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: prof } = await supabase
    .from("profile")
    .select("is_owner")
    .eq("id", user.id)
    .single();
  if (!prof?.is_owner) redirect("/");

  const admin = createAdminClient();
  const { data: helpers } = await admin
    .from("profile")
    .select("id, display_name, username")
    .eq("is_admin", true)
    .eq("is_owner", false)
    .order("display_name");

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-10">
      <div className="w-full max-w-md">
        <header className="text-center">
          <Link
            href="/"
            className="text-sm text-foreground/50 hover:text-foreground/80"
          >
            ← home
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Helpers</h1>
          <p className="mt-1 text-sm text-foreground/60">
            Helpers can enter or fix any game&apos;s score. These logins work any
            time — they don&apos;t need to be playing, and they carry across
            tournaments.
          </p>
        </header>
        <div className="mt-6">
          <HelperManager helpers={helpers ?? []} />
        </div>
      </div>
    </main>
  );
}
