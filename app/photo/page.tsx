import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HomeButton } from "../_components/home-button";
import { togglePhotoDone } from "./actions";

export default async function PhotoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const admin = createAdminClient();
  const [{ data: tournament }, { data: ev }] = await Promise.all([
    admin
      .from("tournament")
      .select("id")
      .neq("status", "archived")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("event_settings")
      .select("photo_album_url")
      .eq("id", 1)
      .maybeSingle(),
  ]);
  const albumUrl: string | null = ev?.photo_album_url ?? null;

  let partnerName: string | null = null;
  let done = false;
  let isPlayer = false;
  if (tournament) {
    const { data: me } = await admin
      .from("player")
      .select("photo_partner_id, photo_done")
      .eq("tournament_id", tournament.id)
      .eq("profile_id", user.id)
      .maybeSingle();
    if (me) {
      isPlayer = true;
      done = me.photo_done;
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
            <p className="mt-2 text-sm text-foreground/70">
              Track them down, grab a fun photo together, and pop it in the
              shared album. Same partner all day — no swaps!
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
            <li>Find your partner and take a photo together.</li>
            <li>Open the shared album below (you may be asked to join it).</li>
            <li>Add your photo straight to the album.</li>
            <li>Come back here and tick it off.</li>
          </ol>
          {albumUrl && (
            <a
              href={albumUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 block rounded-xl bg-brand px-4 py-3 text-center text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Open the shared album →
            </a>
          )}
          <p className="mt-2 text-xs text-foreground/50">
            Photos live in an Apple Shared Album — you upload straight there, not
            through this app.
          </p>
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
