import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EventForm } from "./_form";

export default async function EventPage() {
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

  const { data: ev } = await supabase
    .from("event_settings")
    .select("event_at, venue_name, venue_address, venue_phone, details")
    .eq("id", 1)
    .maybeSingle();

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
            Event details
          </h1>
          <p className="mt-1 text-sm text-foreground/60">
            This is what everyone sees on the landing page — even before they log
            in. Share the link any time.
          </p>
        </header>
        <div className="mt-6">
          <EventForm
            eventAt={ev?.event_at ?? null}
            venueName={ev?.venue_name ?? ""}
            venueAddress={ev?.venue_address ?? ""}
            venuePhone={ev?.venue_phone ?? ""}
            details={ev?.details ?? ""}
          />
        </div>
      </div>
    </main>
  );
}
