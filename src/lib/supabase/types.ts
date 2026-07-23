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
          status: "active" | "pending_verification" | "suspended" | "rejected";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          business_id?: string | null;
          vertical: string;
          role: string;
          status?: "active" | "pending_verification" | "suspended" | "rejected";
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
      // Referrals — 0005_referrals.sql. See ../../../referrals/README.md for
      // the full design (three referral_type values, one shared ledger).
      referrals: {
        Row: {
          id: string;
          referral_type: "peer_join" | "marketer_invite" | "client_endorsement";
          vertical: string;
          referrer_role_profile_id: string | null;
          referee_role_profile_id: string | null;
          referee_email: string | null;
          referee_intended_vertical: string | null;
          referee_intended_role: string | null;
          source_engagement_id: string | null;
          status: "pending" | "accepted" | "declined" | "expired";
          invite_token: string | null;
          created_at: string;
          accepted_at: string | null;
        };
        Insert: {
          id?: string;
          referral_type: "peer_join" | "marketer_invite" | "client_endorsement";
          vertical: string;
          referrer_role_profile_id?: string | null;
          referee_role_profile_id?: string | null;
          referee_email?: string | null;
          referee_intended_vertical?: string | null;
          referee_intended_role?: string | null;
          source_engagement_id?: string | null;
          status?: "pending" | "accepted" | "declined" | "expired";
          invite_token?: string | null;
          created_at?: string;
          accepted_at?: string | null;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["referrals"]["Insert"]>;
      };
      referral_broadcasts: {
        Row: {
          id: string;
          referral_id: string;
          recipient_role_profile_id: string | null;
          recipient_email: string | null;
          sent_at: string;
          registered_role_profile_id: string | null;
        };
        Insert: {
          id?: string;
          referral_id: string;
          recipient_role_profile_id?: string | null;
          recipient_email?: string | null;
          sent_at?: string;
          registered_role_profile_id?: string | null;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["referral_broadcasts"]["Insert"]>;
      };
      // Comms — 0006_notification_dispatch.sql. See ../../../comms/README.md
      // for the full design (two entry points, one pipeline, converging here).
      notification_dispatch: {
        Row: {
          id: string;
          vertical: string;
          role: string;
          channel: "email" | "sms" | "in_app";
          trigger_event: string;
          recipient_email: string;
          recipient_role_profile_id: string | null;
          provider: string;
          provider_message_id: string | null;
          status: "queued" | "sent" | "delivered" | "bounced" | "failed" | "complained";
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vertical: string;
          role: string;
          channel?: "email" | "sms" | "in_app";
          trigger_event: string;
          recipient_email: string;
          recipient_role_profile_id?: string | null;
          provider: string;
          provider_message_id?: string | null;
          status?: "queued" | "sent" | "delivered" | "bounced" | "failed" | "complained";
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["notification_dispatch"]["Insert"]>;
      };
      // Support Escalation — 0007_support_error_reports.sql. See
      // ../../../support-escalation/README.md for the full design (help
      // icon on every error, screenshot + breadcrumb trail, routed to the
      // support team via comms).
      support_error_reports: {
        Row: {
          id: string;
          vertical: string;
          role: string;
          reporter_role_profile_id: string | null;
          reporter_session_id: string;
          error_message: string;
          error_context: Record<string, unknown>;
          breadcrumbs: unknown[];
          screenshot_storage_pointer: string | null;
          status: "new" | "acknowledged" | "resolved";
          created_at: string;
        };
        Insert: {
          id?: string;
          vertical: string;
          role: string;
          reporter_role_profile_id?: string | null;
          reporter_session_id: string;
          error_message: string;
          error_context?: Record<string, unknown>;
          breadcrumbs?: unknown[];
          screenshot_storage_pointer?: string | null;
          status?: "new" | "acknowledged" | "resolved";
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["support_error_reports"]["Insert"]>;
      };
      // Billing rate card — 0008_billing_rate_cards.sql. See
      // ../../../billing/README.md and src/lib/billing/rate-card.ts.
      // "Platform charges" — the percentage cut taken at payout.
      platform_charge_rates: {
        Row: {
          id: string;
          vertical: string;
          service_type_slug: string | null;
          rate: number;
          effective_from: string;
          effective_to: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          vertical: string;
          service_type_slug?: string | null;
          rate: number;
          effective_from: string;
          effective_to?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["platform_charge_rates"]["Insert"]>;
      };
      // "platform membership fee" — a fixed, recurring platform-access fee.
      // Modeled and manageable, not yet actively collected — see
      // src/lib/billing/rate-card.ts's header comment.
      platform_membership_fees: {
        Row: {
          id: string;
          vertical: string;
          role: string;
          amount: number;
          billing_cycle: "monthly" | "quarterly" | "annual";
          effective_from: string;
          effective_to: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          vertical: string;
          role: string;
          amount: number;
          billing_cycle: "monthly" | "quarterly" | "annual";
          effective_from: string;
          effective_to?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["platform_membership_fees"]["Insert"]>;
      };
      // Phase 5 marketplace (CA Focus) slice 10 — 0009_activity_analytics.sql.
      // See ../../../user-analytics/README.md. Verticals write directly
      // against these (same "shared-schema table, no cross-Worker endpoint"
      // pattern as payout_accounts/platform_charge_rates) via their own
      // SiringetbaseSubsetDatabase — this project has no admin surface for
      // it yet, these types exist for consistency/future use.
      activity_event_types: {
        Row: {
          event_type: string;
          vertical: string;
          module: string;
          description: string;
          drives_product_behavior: boolean;
          created_at: string;
        };
        Insert: {
          event_type: string;
          vertical: string;
          module: string;
          description: string;
          drives_product_behavior?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["activity_event_types"]["Insert"]>;
      };
      activity_events: {
        Row: {
          id: string;
          role_profile_id: string | null;
          session_id: string | null;
          vertical: string;
          event_type: string;
          entity_type: string | null;
          entity_id: string | null;
          metadata: Record<string, unknown>;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          role_profile_id?: string | null;
          session_id?: string | null;
          vertical: string;
          event_type: string;
          entity_type?: string | null;
          entity_id?: string | null;
          metadata?: Record<string, unknown>;
          occurred_at?: string;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["activity_events"]["Insert"]>;
      };
      activity_consent: {
        Row: {
          id: string;
          role_profile_id: string | null;
          session_id: string | null;
          purpose: string;
          granted_at: string;
          withdrawn_at: string | null;
        };
        Insert: {
          id?: string;
          role_profile_id?: string | null;
          session_id?: string | null;
          purpose?: string;
          granted_at?: string;
          withdrawn_at?: string | null;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["activity_consent"]["Insert"]>;
      };
      // ../../../supabase/migrations/0010_admin_audit_log.sql — real admin
      // identity + audit trail, src/lib/admin/{auth,audit}.ts.
      admin_audit_log: {
        Row: {
          id: string;
          actor_role_profile_id: string | null;
          actor_user_id: string | null;
          actor_email: string | null;
          actor_role: string | null;
          app: string;
          action: string;
          target_type: string | null;
          target_id: string | null;
          outcome: "success" | "denied" | "error";
          detail: Record<string, unknown>;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
          deleted_at: string | null;
          deleted_by_role_profile_id: string | null;
        };
        Insert: {
          id?: string;
          actor_role_profile_id?: string | null;
          actor_user_id?: string | null;
          actor_email?: string | null;
          actor_role?: string | null;
          app: string;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          outcome: "success" | "denied" | "error";
          detail?: Record<string, unknown>;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          deleted_by_role_profile_id?: string | null;
        };
        Update: Partial<Database["siringetbase"]["Tables"]["admin_audit_log"]["Insert"]>;
      };
    };
  };
}
