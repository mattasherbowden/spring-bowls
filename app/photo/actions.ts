"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type PhotoState = { error?: string };

export async function togglePhotoDone(
  _prev: PhotoState,
  fd: FormData,
): Promise<PhotoState> {
  const done = String(fd.get("done") ?? "") === "true";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in again." };

  const admin = createAdminClient();
  const { data: tournament } = await admin
    .from("tournament")
    .select("id, status")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!tournament) return { error: "No active tournament." };
  if (tournament.status !== "live") {
    return { error: "The draw is being updated — check back in a moment." };
  }

  const { error } = await admin.rpc("set_live_photo_done", {
    p_tournament_id: tournament.id,
    p_profile_id: user.id,
    p_done: done,
  });
  if (error) {
    if (/photo_unavailable/.test(error.message)) {
      return { error: "The draw is being updated — check back in a moment." };
    }
    return {
      error: "Could not update the photo challenge — check your signal and try again.",
    };
  }
  revalidatePath("/photo");
  return {};
}

export async function savePhotoEmail(
  _prev: PhotoState,
  fd: FormData,
): Promise<PhotoState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return { error: "Enter a valid email address." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in again." };

  const admin = createAdminClient();
  const { data: tournament } = await admin
    .from("tournament")
    .select("id, status")
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!tournament) return { error: "No active tournament." };
  if (tournament.status !== "live") {
    return { error: "The draw is being updated — check back in a moment." };
  }

  const { error } = await admin.rpc("set_live_photo_email", {
    p_tournament_id: tournament.id,
    p_profile_id: user.id,
    p_email: email,
  });
  if (error) {
    if (/photo_unavailable/.test(error.message)) {
      return { error: "The draw is being updated — check back in a moment." };
    }
    return { error: "Could not save your email — check your signal and try again." };
  }
  redirect("/photo");
}
