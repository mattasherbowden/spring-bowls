import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HomeButton } from "../_components/home-button";
import { togglePhotoDone, savePhotoEmail } from "./actions";

export default async function PhotoPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  const editing = edit === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const admin = createAdminClient();
  const { data: tournament } = await admin
    .from("tournament")
    .select("id")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();

  let partnerName: string | null = null;
  let email: string | null = null;
  let done = false;
  let isPlayer = false;
  if (tournament) {
    const { data: me } = await admin
      .from("player")
      .select("photo_partner_id, photo_done, photo_email")
      .eq("tournament_id", tournament.id)
      .eq("profile_id", user.id)
      .maybeSingle();
    if (me) {
      isPlayer = true;
      done = me.photo_done;
      email = me.photo_email;
      if (me.photo_partner_id) {
        const { data: partner } = await admin
          .from("player")
          .select("display_name")
          .eq("id", me.photo_partner_id)
          .maybeSingle();
        partnerName = partner?.display_name ?? null;
      }
    }
  }

  const inputCls =
    "mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-base text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between">
          <HomeButton />
          <h1 className="font-display text-xl font-semibold">📸 Photo Bomb</h1>
        </div>

        {isPlayer && partnerName ? (
          <div className="mt-4 rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-foreground/60">
              Your Photo Bomb partner is
            </p>
            <p className="mt-1 font-display text-2xl font-semibold text-brand-dark">
              {partnerName}
            </p>
            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-foreground/40">
              Not to be confused with your loyal and talented bowls partner
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-foreground/60">
            Your partner is assigned once the tournament starts — check back
            soon.
          </p>
        )}

        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <h2 className="text-lg font-semibold">How it works</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-foreground/70">
            <li>Find your Photo Bomb partner and take a photo together.</li>
            <li>Enter your email below — Matt will invite you to the shared album.</li>
            <li>Once you&apos;re in, add your photo (and enjoy everyone else&apos;s).</li>
          </ol>

          {isPlayer &&
            (email && !editing ? (
              <div className="mt-4 rounded-xl bg-brand/10 p-3 ring-1 ring-brand/20">
                <p className="text-sm font-semibold text-brand-dark">
                  ✓ Your email is saved
                </p>
                <p className="mt-0.5 text-sm text-foreground/70">
                  Matt will send an album invite to {email}.
                </p>
                <Link
                  href="/photo?edit=1"
                  className="mt-1 inline-block text-xs font-medium text-brand hover:text-brand-dark"
                >
                  Change email
                </Link>
              </div>
            ) : (
              <form action={savePhotoEmail} className="mt-4">
                <label className="block">
                  <span className="text-sm font-medium">Your email</span>
                  <input
                    name="email"
                    type="email"
                    defaultValue={email ?? ""}
                    placeholder="you@example.com"
                    required
                    className={inputCls}
                  />
                </label>
                <button
                  type="submit"
                  className="mt-2 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark"
                >
                  Save my email
                </button>
              </form>
            ))}
        </section>

        {isPlayer && (
          <form action={togglePhotoDone} className="mt-4">
            <input type="hidden" name="done" value={done ? "false" : "true"} />
            <button
              type="submit"
              className={
                done
                  ? "w-full rounded-xl bg-brand/15 px-4 py-3 text-sm font-semibold text-brand-dark ring-1 ring-brand/30"
                  : "w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium hover:bg-black/[.03]"
              }
            >
              {done ? "✓ Done — tap to undo" : "Mark as completed"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
