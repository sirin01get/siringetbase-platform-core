// Hand-written types matching 0001_init.sql. Once this is running against a
// real Supabase project, regenerate with:
//   npx supabase gen types typescript --schema siringetbase --project-id <ref> > src/lib/supabase/types.ts
// and this file becomes generated, not hand-maintained. Kept manual for
// Phase 0 since there's no real project to generate against yet.

export interface Database {
  siringetbase: {
    Tables: {
      businesses: {
        Row: {
          id: string;
          name: string;
          registration_number: string | null;
          owner_user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          registration_number?: string | null;
          owner_user_id: string;
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["businesses"]["Insert"]>;
      };
      role_profiles: {
        Row: {
          id: string;
          user_id: string | null;
          business_id: string | null;
          vertical: string;
          role: string;
          status: "active" | "pending_verification" | "suspended";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          business_id?: string | null;
          vertical: string;
          role: string;
          status?: "active" | "pending_verification" | "suspended";
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["role_profiles"]["Insert"]>;
      };
      payments: {
        Row: {
          id: string;
          role_profile_id: string;
          vertical: string;
          engagement_id: string | null;
          amount: number;
          currency: string;
          type: "collection" | "payout" | "refund";
          status: "pending" | "completed" | "failed";
          gateway_provider: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          role_profile_id: string;
          vertical: string;
          engagement_id?: string | null;
          amount: number;
          currency?: string;
          type: "collection" | "payout" | "refund";
          status?: "pending" | "completed" | "failed";
          gateway_provider?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["payments"]["Insert"]>;
      };
      escrow_holds: {
        Row: {
          id: string;
          engagement_id: string;
          vertical: string;
          amount: number;
          status: "held" | "released" | "reversed";
          held_at: string;
          released_at: string | null;
          reversed_at: string | null;
        };
        Insert: {
          id?: string;
          engagement_id: string;
          vertical: string;
          amount: number;
          status?: "held" | "released" | "reversed";
          held_at?: string;
          released_at?: string | null;
          reversed_at?: string | null;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["escrow_holds"]["Insert"]>;
      };
      commission_ledger: {
        Row: {
          id: string;
          escrow_hold_id: string;
          vertical: string;
          service_provider_role_profile_id: string;
          commission_rate: number;
          commission_amount: number;
          net_payout_amount: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          escrow_hold_id: string;
          vertical: string;
          service_provider_role_profile_id: string;
          commission_rate: number;
          commission_amount: number;
          net_payout_amount: number;
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["commission_ledger"]["Insert"]>;
      };
      payout_accounts: {
        Row: {
          id: string;
          role_profile_id: string;
          account_holder_name: string;
          account_number_last4: string;
          bank_name: string;
          ifsc: string;
          verified: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          role_profile_id: string;
          account_holder_name: string;
          account_number_last4: string;
          bank_name: string;
          ifsc: string;
          verified?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["payout_accounts"]["Insert"]>;
      };
      provider_transactions: {
        Row: {
          id: string;
          payment_id: string | null;
          escrow_hold_id: string | null;
          provider: string;
          provider_transaction_id: string;
          request_snapshot: Record<string, unknown>;
          response_snapshot: Record<string, unknown>;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          payment_id?: string | null;
          escrow_hold_id?: string | null;
          provider: string;
          provider_transaction_id: string;
          request_snapshot: Record<string, unknown>;
          response_snapshot: Record<string, unknown>;
          status: string;
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["provider_transactions"]["Insert"]>;
      };
      entity_sync_queue: {
        // attempts/next_attempt_at and the 'dead_letter' status come from
        // supabase/migrations/0002_sync_retry_hardening.sql — see
        // ../entity-graph/data-sync-architecture.md §4 and src/lib/entity-graph/sync.ts.
        // 'engagement' comes from 0003_document_intelligence_skeleton.sql —
        // CA Focus Phase 1's (:Person)-[:ENGAGED]->(:ServiceProvider) sync.
        Row: {
          id: string;
          entity_type: "person" | "business" | "service_provider" | "engagement";
          entity_id: string;
          vertical: string;
          operation: "upsert" | "delete";
          payload: Record<string, unknown>;
          status: "pending" | "processed" | "failed" | "dead_letter";
          attempts: number;
          next_attempt_at: string;
          error: string | null;
          created_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          entity_type: "person" | "business" | "service_provider" | "engagement";
          entity_id: string;
          vertical: string;
          operation: "upsert" | "delete";
          payload: Record<string, unknown>;
          status?: "pending" | "processed" | "failed" | "dead_letter";
          attempts?: number;
          next_attempt_at?: string;
          error?: string | null;
          created_at?: string;
          processed_at?: string | null;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["entity_sync_queue"]["Insert"]>;
      };
      invoices: {
        Row: {
          id: string;
          payment_id: string;
          vertical: string;
          line_items: unknown[];
          gst_details: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          payment_id: string;
          vertical: string;
          line_items?: unknown[];
          gst_details?: Record<string, unknown> | null;
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["invoices"]["Insert"]>;
      };
      // Document Intelligence skeleton — 0003_document_intelligence_skeleton.sql.
      // See ../../document-intelligence/README.md for the full pipeline this
      // is a skeleton of; only the tables exist so far, not the mechanics.
      extraction_templates: {
        Row: {
          id: string;
          document_type: string;
          vertical: string;
          owning_module: string;
          prompt: string;
          output_schema: Record<string, unknown>;
          confidence_threshold: number;
          requires_human_review: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_type: string;
          vertical: string;
          owning_module: string;
          prompt: string;
          output_schema: Record<string, unknown>;
          confidence_threshold?: number;
          requires_human_review?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["extraction_templates"]["Insert"]>;
      };
      documents: {
        Row: {
          id: string;
          owner_role_profile_id: string;
          vertical: string;
          document_type: string;
          storage_pointer: string;
          original_filename: string | null;
          status: "uploaded" | "extraction_queued" | "extraction_completed" | "extraction_failed";
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_role_profile_id: string;
          vertical: string;
          document_type: string;
          storage_pointer: string;
          original_filename?: string | null;
          status?: "uploaded" | "extraction_queued" | "extraction_completed" | "extraction_failed";
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["documents"]["Insert"]>;
      };
      extraction_jobs: {
        Row: {
          id: string;
          document_id: string;
          template_id: string;
          status: "queued" | "processing" | "completed" | "failed";
          raw_output: Record<string, unknown> | null;
          interpretation: Record<string, unknown> | null;
          confidence: number | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          document_id: string;
          template_id: string;
          status?: "queued" | "processing" | "completed" | "failed";
          raw_output?: Record<string, unknown> | null;
          interpretation?: Record<string, unknown> | null;
          confidence?: number | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["extraction_jobs"]["Insert"]>;
      };
    };
  };
}
