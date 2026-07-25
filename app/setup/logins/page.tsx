import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ProfileLite = {
  username: string | null;
  login_password: string | null;
  is_owner: boolean | null;
} | null;

type PlayerRow = {
  display_name: string;
  role: string | null;
  nationality: string | null;
  profile: ProfileLite;
};

type TeamRow = {
  id: string;
  name: string | null;
  group_label: string | null;
  players: PlayerRow[];
};

type HelperRow = {
  display_name: string | null;
  username: string | null;
  login_password: string | null;
};

function flag(nat: string | null): string {
  if (nat === "brit") return " 🇬🇧";
  if (nat === "kiwi") return " 🇳🇿";
  return "";
}

function CredRow({
  name,
  username,
  password,
  isOwner,
}: {
  name: string;
  username: string | null;
  password: string | null;
  isOwner?: boolean;
}) {
  return (
    <tr className="border-t border-black/5 align-top">
      <td className="py-1.5 pr-2">{name}</td>
      {isOwner ? (
        <td className="py-1.5 text-foreground/50" colSpan={2}>
          your organiser login
        </td>
      ) : (
        <>
          <td className="py-1.5 pr-2 font-mono">{username ?? "—"}</td>
          <td className="py-1.5 font-mono">
            {password ? (
              password
            ) : (
              <span className="font-sans text-xs text-foreground/40">
                not saved
              </span>
            )}
          </td>
        </>
      )}
    </tr>
  );
}

export default async function LoginsPage() {
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

  const teams = tournament
    ? ((
        await admin
          .from("team")
          .select(
            "id, name, group_label, players:player(display_name, role, nationality, profile:profile_id(username, login_password, is_owner))",
          )
          .eq("tournament_id", tournament.id)
          .order("group_label", { ascending: true, nullsFirst: true })
      ).data as TeamRow[] | null) ?? []
    : [];

  const { data: helperData } = await admin
    .from("profile")
    .select("display_name, username, login_password")
    .eq("is_admin", true)
    .eq("is_owner", false)
    .order("display_name");
  const helpers = (helperData as HelperRow[] | null) ?? [];

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
            Logins &amp; passwords
          </h1>
          <p className="mt-1 text-sm text-foreground/60">
            Every login in one place, so you can remind anyone who loses their
            card. Only you can see this page — keep it to yourself.
          </p>
        </header>

        {!tournament ? (
          <p className="mt-8 text-center text-sm text-foreground/60">
            No tournament yet — add teams first and their logins will appear
            here.
          </p>
        ) : (
          <div className="mt-6 space-y-4">
            {teams.length === 0 && (
              <p className="text-center text-sm text-foreground/60">
                No teams added yet.
              </p>
            )}
            {teams.map((t) => (
              <section
                key={t.id}
                className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"
              >
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display text-base font-semibold">
                    {t.name ??
                      t.players.map((p) => p.display_name).join(" & ") ??
                      "Team"}
                  </h2>
                  {t.group_label && (
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand-dark">
                      Group {t.group_label}
                    </span>
                  )}
                </div>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-foreground/40">
                      <th className="font-medium">Player</th>
                      <th className="font-medium">Username</th>
                      <th className="font-medium">Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.players.map((p, i) => (
                      <CredRow
                        key={i}
                        name={`${p.display_name}${flag(p.nationality)}`}
                        username={p.profile?.username ?? null}
                        password={p.profile?.login_password ?? null}
                        isOwner={!!p.profile?.is_owner}
                      />
                    ))}
                  </tbody>
                </table>
              </section>
            ))}

            {helpers.length > 0 && (
              <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <h2 className="font-display text-base font-semibold">Helpers</h2>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-foreground/40">
                      <th className="font-medium">Name</th>
                      <th className="font-medium">Username</th>
                      <th className="font-medium">Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {helpers.map((h, i) => (
                      <CredRow
                        key={i}
                        name={h.display_name ?? h.username ?? "Helper"}
                        username={h.username}
                        password={h.login_password}
                      />
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-foreground/40">
                  A helper with “not saved” was created before passwords were
                  stored — use “Manage helpers” to reset and reveal a new one.
                </p>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
