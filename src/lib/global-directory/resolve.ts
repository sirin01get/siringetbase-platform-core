import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Resolve/link — the directory's one job (GLOBAL/01 §B): signup anywhere →
// lookup by email hash → new global_person_id or link to existing. Called
// only by the ingest API route (service-to-service), never by browsers.
// Idempotent by construction: resolving the same (email_hash, region,
// local_user_id) twice returns the same ids.

export type Region = "us" | "in";

export interface ResolveParams {
  emailHash: string; // precomputed by the regional caller — see hash.ts
  region: Region;
  localUserId: string;
}

export interface ResolveResult {
  globalPersonId: string;
  created: boolean; // true when this call created the directory row
  linked: boolean; // true when this call added the regional profile link
}

export async function resolveOrLink(params: ResolveParams): Promise<ResolveResult> {
  const supabase = createSupabaseServiceRoleClient();

  // 1. Find or create the directory row keyed by email hash.
  const { data: existing, error: lookupError } = await supabase
    .from("global_directory")
    .select("global_person_id")
    .eq("email_hash", params.emailHash)
    .maybeSingle();
  if (lookupError) throw new Error(`Directory lookup failed: ${lookupError.message}`);

  let globalPersonId = existing?.global_person_id as string | undefined;
  let created = false;

  if (!globalPersonId) {
    const { data: inserted, error: insertError } = await supabase
      .from("global_directory")
      .insert({ email_hash: params.emailHash, home_region: params.region })
      .select("global_person_id")
      .single();
    if (insertError) {
      // Unique-violation race: another signup created it between our
      // lookup and insert — re-read instead of failing (idempotency).
      const { data: raced, error: rereadError } = await supabase
        .from("global_directory")
        .select("global_person_id")
        .eq("email_hash", params.emailHash)
        .single();
      if (rereadError || !raced) throw new Error(`Directory insert failed: ${insertError.message}`);
      globalPersonId = raced.global_person_id as string;
    } else {
      globalPersonId = inserted.global_person_id as string;
      created = true;
    }
  }

  // 2. Link the regional profile (no-op if already linked).
  const { error: linkError } = await supabase.from("global_regional_profiles").upsert(
    {
      global_person_id: globalPersonId,
      region: params.region,
      local_user_id: params.localUserId,
    },
    { onConflict: "global_person_id,region", ignoreDuplicates: true }
  );
  if (linkError) throw new Error(`Regional profile link failed: ${linkError.message}`);

  return { globalPersonId, created, linked: true };
}
