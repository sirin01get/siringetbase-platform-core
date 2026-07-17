import { env } from "@/config/env";

// Neo4j's Bolt protocol (what `neo4j-driver` speaks) needs a raw TCP
// connection. Cloudflare Workers cannot open arbitrary TCP connections, so
// `neo4j-driver` cannot work here at all — not a config problem, a platform
// one. (Confirmed against both Cloudflare's own Workers docs and Neo4j's
// community guidance for edge runtimes; Cloudflare has TCP/QUIC sockets in
// the pipeline, but `neo4j-driver` has no Workers-compatible transport
// built on it yet.)
//
// Instead, this talks to Neo4j's Query API — plain HTTPS, works with
// `fetch()` like everything else in this Worker. It's the officially
// supported route for exactly this situation (introduced in Neo4j 5.19,
// enabled by default, and the only way in on Aura, which only exposes
// HTTPS on port 443 for it). See https://neo4j.com/docs/query-api/current/.
//
// NEO4J_URI is still stored in its familiar Bolt form
// (neo4j+s://<instance-id>.databases.neo4j.io) so the existing instructions
// for copying it straight from Aura's Connect screen don't change — this
// module just takes the hostname portion and always talks HTTPS to it.

function queryApiUrl(): string {
  const raw = env.neo4jUri();
  const host = raw.includes("://") ? raw.split("://")[1] : raw;
  return `https://${host}/db/${env.neo4jDatabase()}/query/v2`;
}

// UTF-8-safe base64 encoding for the Basic auth header — deliberately not
// using Node's `Buffer` (available via nodejs_compat, but this avoids
// depending on that compat layer working correctly for something this
// foundational; `btoa`/`TextEncoder` are plain Web APIs Workers implement
// natively).
function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function authHeader(): string {
  return `Basic ${toBase64(`${env.neo4jUser()}:${env.neo4jPassword()}`)}`;
}

interface QueryApiResponse {
  // Plain JSON result format: each row in `values` is an array positionally
  // matching `fields`. See https://neo4j.com/docs/query-api/current/plain-json/
  data?: { fields: string[]; values: unknown[][] };
  errors?: { code: string; message: string }[];
}

export class Neo4jQueryError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "Neo4jQueryError";
  }
}

// Runs a single Cypher statement via the Query API (implicit transaction —
// see ../../platform-core/README.md if explicit multi-statement
// transactions are ever needed, that's a different endpoint) and returns
// rows as plain objects keyed by field name, similar to what a Bolt
// session's result would have given.
export async function runCypher(
  statement: string,
  parameters: Record<string, unknown> = {}
): Promise<Record<string, unknown>[]> {
  const res = await fetch(queryApiUrl(), {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ statement, parameters }),
  });

  // The Query API returns 202 regardless of whether the statement itself
  // succeeded — failures surface inside the body's `errors` array instead.
  // The one exception is authentication failures, which come back as a
  // genuine 401 before the statement is even attempted.
  if (res.status === 401) {
    const body = await res.text();
    throw new Neo4jQueryError(`Neo4j authentication failed (401): ${body.slice(0, 300)}`, "UNAUTHORIZED");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Neo4jQueryError(`Neo4j Query API returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as QueryApiResponse;

  const firstError = json.errors?.[0];
  if (firstError) {
    throw new Neo4jQueryError(firstError.message, firstError.code);
  }

  const fields = json.data?.fields ?? [];
  const values = json.data?.values ?? [];
  return values.map((row) => Object.fromEntries(fields.map((field, i) => [field, row[i]])));
}

// Cheap connectivity check for /api/diagnostics — a trivial query proves
// the URI, credentials, and network path all work without touching real
// data.
export async function checkNeo4jConnectivity(): Promise<{ ok: boolean; error?: string }> {
  try {
    await runCypher("RETURN 1 AS ok");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
