import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { error } = await createAdminClient()
      .from("tournament")
      .select("id")
      .limit(1);
    if (error) {
      console.error("Database warm-up failed", error.message);
      return Response.json({ ok: false }, { status: 503 });
    }
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "Database warm-up failed",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ ok: false }, { status: 503 });
  }
}
