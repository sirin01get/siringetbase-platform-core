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
// (:ServiceProvider)-[:SPECIALIZES_IN]->(:ServiceType)
// (:Person)-[:REFERRED]->(:Person)
// (:Document)-[:FEEDS]->(:Engagement)   -- Document nodes owned by
//                                          document-intelligence, not this file
