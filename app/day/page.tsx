import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EventInfo, type EventInfoData } from "../_components/event-info";
import { HomeButton } from "../_components/home-button";
import { SBMark } from "../_components/sb-mark";

export default async function DayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: ev } = await supabase
    .from("event_settings")
    .select("event_at, venue_name, venue_address, venue_phone, details")
    .eq("id", 1)
    .maybeSingle();

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between">
          <HomeButton />
          <h1 className="font-display text-xl font-semibold">
            <SBMark className="mr-1.5" />Day plan
          </h1>
        </div>
        {ev ? (
          <EventInfo ev={ev as EventInfoData} />
        ) : (
          <p className="mt-6 text-sm text-foreground/60">
            The day&apos;s details will appear here soon.
          </p>
        )}
      </div>
    </main>
  );
}
