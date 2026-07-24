"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function togglePhotoDone(fd: FormData): Promise<void> {
  const done = String(fd.get("done") ?? "") === "true";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const admin = createAdminClient();
  const { data: tournament } = await admin
    .from("tournament")
    .select("id")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!tournament) return;

  await admin
    .from("player")
    .update({ photo_done: done })
    .eq("tournament_id", tournament.id)
    .eq("profile_id", user.id);
  revalidatePath("/photo");
}
