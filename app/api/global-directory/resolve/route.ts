import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { resolveOrLink, type Region } from "@/lib/global-directory/resolve";

interface ResolveBody {
  email_hash?: string;
  region?: string;
  local_user_id?: string;
}

// POST /api/global-directory/resolve — the ingest API stub for GLOBAL/01
// §B/§C: a regional instance's signup flow (or its outbox-queue consumer)
// calls this on the siringet-global deployment with a precomputed email
// hash. Same shared-secret posture as /api/payments/hold — a
// service-to-service surface, never a browser. The full outbox→queue
// delivery mechanism comes later; this endpoint is deliberately built now
// because retrofitting identity linking after two instances have disjoint
// accounts is the expensive path ("cheap now, painful later" —
// KICKOFF work order 5).
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-global-directory-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.globalDirectoryInternalSecret())) {
    return NextResponse.json(
      { status: "error", message: "Missing or invalid x-global-directory-internal-secret header" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as ResolveBody;
  const { email_hash, region, local_user_id } = body;

  if (
    !email_hash ||
    !/^[0-9a-f]{64}$/.test(email_hash) || // SHA-256 hex — reject anything that could be a raw email
    !local_user_id ||
    (region !== "us" && region !== "in")
  ) {
    return NextResponse.json(
      {
        status: "error",
        message:
          "Expected { email_hash (sha256 hex), region ('us'|'in'), local_user_id }. Raw emails are never accepted here.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await resolveOrLink({
      emailHash: email_hash,
      region: region as Region,
      localUserId: local_user_id,
    });
    return NextResponse.json({
      status: "ok",
      global_person_id: result.globalPersonId,
      created: result.created,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
