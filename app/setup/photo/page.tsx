import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HomeButton } from "../../_components/home-button";

type Row = {
  display_name: string;
  photo_email: string | null;
  photo_done: boolean;
};

export default async function PhotoAdminPage() {
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
  const { data: tournament } = await admin
    .from("tournament")
    .select("id")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  const { data: ev } = await supabase
    .from("event_settings")
    .select("photo_album_url")
    .eq("id", 1)
    .maybeSingle();

  let players: Row[] = [];
  if (tournament) {
    const { data } = await admin
      .from("player")
      .select("display_name, photo_email, photo_done")
      .eq("tournament_id", tournament.id)
      .order("display_name");
    players = (data ?? []) as Row[];
  }
  const withEmail = players.filter((p) => p.photo_email);
  const emailList = withEmail.map((p) => p.photo_email).join(", ");

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between">
          <HomeButton />
          <h1 className="font-display text-xl font-semibold">📸 Photo Bomb</h1>
        </div>

        <p className="mt-4 text-sm text-foreground/60">
          Invite these emails to your Apple Shared Album as contributors, so
          everyone can add their photos.
          {ev?.photo_album_url && (
            <>
              {" "}
              <a
                href={ev.photo_album_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand hover:text-brand-dark"
              >
                Open your album →
              </a>
            </>
          )}
        </p>

        {withEmail.length > 0 && (
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <h2 className="text-sm font-semibold">
              All emails ({withEmail.length})
            </h2>
            <p className="mt-1 block select-all break-words font-mono text-xs text-foreground/70">
              {emailList}
            </p>
          </section>
        )}

        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <h2 className="text-sm font-semibold">Everyone ({players.length})</h2>
          <ul className="mt-2 divide-y divide-black/5 text-sm">
            {players.map((p, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="min-w-0">
                  <span className="font-medium">{p.display_name}</span>
                  <span className="block truncate text-xs text-foreground/50">
                    {p.photo_email ?? "no email yet"}
                  </span>
                </span>
                {p.photo_done && (
                  <span className="shrink-0 text-xs font-semibold text-brand-dark">
                    done ✓
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
