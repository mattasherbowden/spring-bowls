import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./_components/login-form";
import { CreateOwnerForm } from "./_components/create-owner-form";
import { logout } from "./actions";

type Profile = {
  display_name: string;
  username: string;
  is_owner: boolean;
};

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: Profile | null = null;
  let setupDone = true;

  if (user) {
    const { data } = await supabase
      .from("profile")
      .select("display_name, username, is_owner")
      .eq("id", user.id)
      .single();
    profile = data;
  } else {
    const { data } = await supabase.rpc("owner_exists");
    setupDone = Boolean(data);
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <header className="text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-brand">
            7th edition
          </p>
          <h1 className="mt-2 text-5xl font-bold tracking-tight">
            Spring <span className="text-brand">Bowls</span>
          </h1>
          <div className="mt-4 flex justify-center">
            <span className="rounded-full bg-white px-3 py-1 text-sm font-medium shadow-sm ring-1 ring-black/5">
              🇬🇧 BYO Brit edition 🥝
            </span>
          </div>
          <p className="mt-4 text-base text-foreground/70">
            Saturday 1 August 2026
          </p>
        </header>

        <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          {profile ? (
            <LoggedIn profile={profile} />
          ) : setupDone ? (
            <>
              <h2 className="text-lg font-semibold">Log in</h2>
              <p className="mt-1 text-sm text-foreground/60">
                Use the username and password from your card.
              </p>
              <LoginForm />
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Set up your account</h2>
              <p className="mt-1 text-sm text-foreground/60">
                You are first here — create the host (owner) account. Only you
                can create and run the tournament.
              </p>
              <CreateOwnerForm />
            </>
          )}
        </section>

        <p className="mt-6 text-center text-xs text-foreground/50">
          See you on the green.
        </p>
      </div>
    </main>
  );
}

function LoggedIn({ profile }: { profile: Profile }) {
  const firstName = profile.display_name.split(" ")[0];
  return (
    <div>
      <h2 className="text-lg font-semibold">Welcome, {firstName}</h2>
      <p className="mt-1 text-sm text-foreground/60">
        Signed in as <span className="font-medium">@{profile.username}</span>
        {profile.is_owner && (
          <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-dark">
            owner
          </span>
        )}
      </p>
      <p className="mt-4 text-sm text-foreground/70">
        {profile.is_owner
          ? "Next we will build your tournament setup here — teams, rinks and the schedule."
          : "Your next fixture and scores will appear here once the tournament starts."}
      </p>
      <form action={logout} className="mt-5">
        <button className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium hover:bg-black/[.03]">
          Log out
        </button>
      </form>
    </div>
  );
}
