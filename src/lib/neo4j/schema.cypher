// Siringetbase Entity Graph — Phase 0 schema bootstrap.
// Run once against a fresh Neo4j instance (Aura or self-hosted) via
// `npm run neo4j:bootstrap` (see package.json) or paste into Neo4j Browser.
// Matches ../../entity-graph/README.md's node types exactly.

// --- Constraints (also create the backing indexes) -------------------------

// role_profile_id is the join key back to Postgres for :Person and
// :Business nodes — see src/lib/entity-graph/sync.ts.
CREATE CONSTRAINT person_role_profile_id IF NOT EXISTS
FOR (p:Person) REQUIRE p.role_profile_id IS UNIQUE;

CREATE CONSTRAINT business_role_profile_id IF NOT EXISTS
FOR (b:Business) REQUIRE b.role_profile_id IS UNIQUE;

CREATE CONSTRAINT service_provider_role_profile_id IF NOT EXISTS
FOR (sp:ServiceProvider) REQUIRE sp.role_profile_id IS UNIQUE;

CREATE CONSTRAINT engagement_id IF NOT EXISTS
FOR (e:Engagement) REQUIRE e.engagement_id IS UNIQUE;

// ServiceType nodes are identified by a compound key (vertical + slug), not
// a single unique field, since 'audit' could mean different things across
// verticals in principle — enforced by an index rather than a uniqueness
// constraint since Neo4j community doesn't support composite uniqueness
// constraints the same way; application code enforces the compound-key
// invariant on write.
CREATE INDEX service_type_vertical_slug IF NOT EXISTS
FOR (st:ServiceType) ON (st.vertical, st.slug);

// --- Property indexes for common lookups ------------------------------------

CREATE INDEX person_vertical IF NOT EXISTS FOR (p:Person) ON (p.vertical);
CREATE INDEX business_vertical IF NOT EXISTS FOR (b:Business) ON (b.vertical);
CREATE INDEX service_provider_vertical IF NOT EXISTS FOR (sp:ServiceProvider) ON (sp.vertical);

// --- Relationship shape (created per-record by sync.ts, not here) ----------
// (:Person)-[:ENGAGED]->(:ServiceProvider)
// (:Person)-[:INITIATED]->(:Engagement)-[:WITH_PROVIDER]->(:ServiceProvider)
//   -- added for CA Focus Phase 5's matching engine: lets a query traverse
//      "which of this ServiceProvider's engagements are completed, in which
//      service type" — the plain :ENGAGED edge above can't (no reference to
//      a specific engagement or its status). See
//      ../../../cafocus/phases/phase-1-core-data-graph-model/sync-contract.md.
// (:ServiceProvider)-[:SPECIALIZES_IN]->(:ServiceType)
// (:Person)-[:REFERRED]->(:Person)
// (:Document)-[:FEEDS]->(:Engagement)   -- Document nodes owned by
//                                          document-intelligence, not this file

// --- ServiceType adjacency seed (CA Focus, Phase 5 slice 9) -----------------
// ../../../cafocus/phases/phase-5-marketplace-module/README.md's "Matching
// engine" workstream calls for specialization-hierarchy matching (e.g.
// suggesting an adjacent specialty) once the flat ServiceType set gets a
// real hierarchy. CA Focus's three ServiceType nodes
// (tax-filing/gst-filing/auditing — MERGE-created lazily by
// entity-graph/sync.ts whenever a CA's service_catalog_entries sync, not
// here) are still flat, not a tree — this is a deliberately small, honest
// first step: a hand-picked adjacency, not a generated hierarchy.
// tax-filing <-> gst-filing are adjacent because they're both routine
// compliance filings a CA commonly offers together; auditing is kept
// separate — it requires distinct qualification/experience, so suggesting
// an auditor when someone asked for a tax-filing CA (or vice versa) would
// be a worse match, not a helpful fallback. Revisit if CA Focus ever adds
// more ServiceTypes — this is a static seed, not derived from any data.
// MERGE, not CREATE — idempotent, and creates the ServiceType nodes if the
// bootstrap script runs before any CA has published a catalog entry.
MERGE (tf:ServiceType {vertical: 'cafocus', slug: 'tax-filing'})
MERGE (gst:ServiceType {vertical: 'cafocus', slug: 'gst-filing'})
MERGE (tf)-[:ADJACENT_TO]-(gst);
