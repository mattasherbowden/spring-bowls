import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RecoveryPanel, ChangePasswordForm } from "./_recovery";

export default async function OwnerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: prof } = await supabase
    .from("profile")
    .select("is_owner, username, recovery_hash")
    .eq("id", user.id)
    .single();
  if (!prof?.is_owner) redirect("/");

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
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Owner account
          </h1>
          <p className="mt-1 text-sm text-foreground/60">@{prof.username}</p>
        </header>

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <h2 className="text-lg font-semibold">Recovery code</h2>
          <p className="mt-1 text-sm text-foreground/60">
            You have no email on file (by design), so this is the only way to
            reset your password if you forget it. Generate one and keep it
            somewhere safe.
          </p>
          <RecoveryPanel hasCode={!!prof.recovery_hash} />
        </section>

        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <h2 className="text-lg font-semibold">Change password</h2>
          <p className="mt-1 text-sm text-foreground/60">
            Set your own password — you&apos;re logged in, so no code needed.
          </p>
          <ChangePasswordForm />
        </section>
      </div>
    </main>
  );
}
