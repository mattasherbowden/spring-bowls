import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SetupWizard } from "./_wizard";

export default async function SetupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("profile")
    .select("is_owner")
    .eq("id", user.id)
    .single();
  if (!profile?.is_owner) redirect("/");

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-10">
      <div className="w-full max-w-lg">
        <header className="text-center">
          <Link
            href="/"
            className="text-sm text-foreground/50 hover:text-foreground/80"
          >
            ← back
          </Link>
          <p className="mt-2 text-sm font-medium uppercase tracking-[0.2em] text-brand">
            new tournament
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Set up the day
          </h1>
          <p className="mt-2 text-sm text-foreground/60">
            Tweak the numbers and watch the plan update. Nothing is created until
            you confirm.
          </p>
        </header>

        <div className="mt-6">
          <SetupWizard />
        </div>
      </div>
    </main>
  );
}
