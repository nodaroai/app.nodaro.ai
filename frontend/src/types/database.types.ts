export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_alerts: {
        Row: {
          alert_type: string
          created_at: string | null
          id: string
          is_resolved: boolean | null
          message: string
          metadata: Json | null
          severity: string
        }
        Insert: {
          alert_type: string
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          message: string
          metadata?: Json | null
          severity: string
        }
        Update: {
          alert_type?: string
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          message?: string
          metadata?: Json | null
          severity?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          created_at: string
          expires_at: string | null
          filename: string
          id: string
          is_library_item: boolean | null
          is_shared: boolean | null
          job_id: string | null
          metadata: Json | null
          mime_type: string
          r2_key: string
          r2_url: string
          size_bytes: number
          thumbnail_r2_key: string | null
          thumbnail_url: string | null
          type: string
          upload_source: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          filename: string
          id?: string
          is_library_item?: boolean | null
          is_shared?: boolean | null
          job_id?: string | null
          metadata?: Json | null
          mime_type: string
          r2_key: string
          r2_url: string
          size_bytes: number
          thumbnail_r2_key?: string | null
          thumbnail_url?: string | null
          type: string
          upload_source?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          filename?: string
          id?: string
          is_library_item?: boolean | null
          is_shared?: boolean | null
          job_id?: string | null
          metadata?: Json | null
          mime_type?: string
          r2_key?: string
          r2_url?: string
          size_bytes?: number
          thumbnail_r2_key?: string | null
          thumbnail_url?: string | null
          type?: string
          upload_source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      characters: {
        Row: {
          asset_category: string | null
          base_outfit: string | null
          character_sheet: Json | null
          created_at: string
          description: string | null
          expressions: Json | null
          gender: string | null
          id: string
          lighting_variations: Json | null
          name: string
          node_id: string | null
          poses: Json | null
          project_id: string | null
          reference_image_url: string | null
          source_image_url: string | null
          style: string | null
          updated_at: string | null
          user_id: string | null
          visual_traits: Json
          workflow_id: string | null
        }
        Insert: {
          asset_category?: string | null
          base_outfit?: string | null
          character_sheet?: Json | null
          created_at?: string
          description?: string | null
          expressions?: Json | null
          gender?: string | null
          id?: string
          lighting_variations?: Json | null
          name: string
          node_id?: string | null
          poses?: Json | null
          project_id?: string | null
          reference_image_url?: string | null
          source_image_url?: string | null
          style?: string | null
          updated_at?: string | null
          user_id?: string | null
          visual_traits?: Json
          workflow_id?: string | null
        }
        Update: {
          asset_category?: string | null
          base_outfit?: string | null
          character_sheet?: Json | null
          created_at?: string
          description?: string | null
          expressions?: Json | null
          gender?: string | null
          id?: string
          lighting_variations?: Json | null
          name?: string
          node_id?: string | null
          poses?: Json | null
          project_id?: string | null
          reference_image_url?: string | null
          source_image_url?: string | null
          style?: string | null
          updated_at?: string | null
          user_id?: string | null
          visual_traits?: Json
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "characters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_purchases: {
        Row: {
          amount_usd: number
          created_at: string
          credits: number
          id: string
          paddle_transaction_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          credits: number
          id?: string
          paddle_transaction_id?: string | null
          status: string
          user_id: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          credits?: number
          id?: string
          paddle_transaction_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          admin_user_id: string | null
          amount: number
          balance_after: number
          created_at: string | null
          credit_type: string
          description: string | null
          id: string
          job_id: string | null
          paddle_transaction_id: string | null
          source: string
          user_id: string
        }
        Insert: {
          admin_user_id?: string | null
          amount: number
          balance_after: number
          created_at?: string | null
          credit_type: string
          description?: string | null
          id?: string
          job_id?: string | null
          paddle_transaction_id?: string | null
          source: string
          user_id: string
        }
        Update: {
          admin_user_id?: string | null
          amount?: number
          balance_after?: number
          created_at?: string | null
          credit_type?: string
          description?: string | null
          id?: string
          job_id?: string | null
          paddle_transaction_id?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      executions: {
        Row: {
          cost: number | null
          created_at: string | null
          id: string
          model: string | null
          node_id: string | null
          prediction_id: string
          status: string | null
          user_id: string | null
          workflow_id: string | null
        }
        Insert: {
          cost?: number | null
          created_at?: string | null
          id?: string
          model?: string | null
          node_id?: string | null
          prediction_id: string
          status?: string | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Update: {
          cost?: number | null
          created_at?: string | null
          id?: string
          model?: string | null
          node_id?: string | null
          prediction_id?: string
          status?: string | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "executions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      faces: {
        Row: {
          created_at: string | null
          description: string | null
          expressions: Json | null
          id: string
          name: string
          node_id: string
          project_id: string | null
          source_image_url: string | null
          style: string | null
          updated_at: string | null
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          expressions?: Json | null
          id?: string
          name: string
          node_id: string
          project_id?: string | null
          source_image_url?: string | null
          style?: string | null
          updated_at?: string | null
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          expressions?: Json | null
          id?: string
          name?: string
          node_id?: string
          project_id?: string | null
          source_image_url?: string | null
          style?: string | null
          updated_at?: string | null
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: []
      }
      folders: {
        Row: {
          created_at: string
          id: string
          name: string
          project_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          project_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      gallery_reports: {
        Row: {
          created_at: string | null
          details: string | null
          id: string
          job_id: string | null
          reason: string
          reporter_ip: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          details?: string | null
          id?: string
          job_id?: string | null
          reason: string
          reporter_ip?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          details?: string | null
          id?: string
          job_id?: string | null
          reason?: string
          reporter_ip?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gallery_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_checkpoints: {
        Row: {
          created_at: string
          data: Json
          id: string
          job_id: string
          step: string
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          job_id: string
          step: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          job_id?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_checkpoints_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          credits_estimated: number | null
          credits_used: number | null
          display_cost: number | null
          error_message: string | null
          id: string
          input_data: Json
          is_public: boolean | null
          job_type: string | null
          output_data: Json | null
          parent_job_id: string | null
          priority: number
          progress: number
          provider: string | null
          provider_cost: number | null
          started_at: string | null
          status: string
          usage_log_id: string | null
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          credits_estimated?: number | null
          credits_used?: number | null
          display_cost?: number | null
          error_message?: string | null
          id?: string
          input_data?: Json
          is_public?: boolean | null
          job_type?: string | null
          output_data?: Json | null
          parent_job_id?: string | null
          priority?: number
          progress?: number
          provider?: string | null
          provider_cost?: number | null
          started_at?: string | null
          status?: string
          usage_log_id?: string | null
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          credits_estimated?: number | null
          credits_used?: number | null
          display_cost?: number | null
          error_message?: string | null
          id?: string
          input_data?: Json
          is_public?: boolean | null
          job_type?: string | null
          output_data?: Json | null
          parent_job_id?: string | null
          priority?: number
          progress?: number
          provider?: string | null
          provider_cost?: number | null
          started_at?: string | null
          status?: string
          usage_log_id?: string | null
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          angles: Json | null
          category: string | null
          created_at: string | null
          custom_variations: Json | null
          description: string | null
          id: string
          main_image_url: string | null
          name: string
          node_id: string | null
          project_id: string | null
          source_image_url: string | null
          style: string | null
          time_of_day: Json | null
          updated_at: string | null
          user_id: string | null
          weather: Json | null
          workflow_id: string | null
        }
        Insert: {
          angles?: Json | null
          category?: string | null
          created_at?: string | null
          custom_variations?: Json | null
          description?: string | null
          id?: string
          main_image_url?: string | null
          name: string
          node_id?: string | null
          project_id?: string | null
          source_image_url?: string | null
          style?: string | null
          time_of_day?: Json | null
          updated_at?: string | null
          user_id?: string | null
          weather?: Json | null
          workflow_id?: string | null
        }
        Update: {
          angles?: Json | null
          category?: string | null
          created_at?: string | null
          custom_variations?: Json | null
          description?: string | null
          id?: string
          main_image_url?: string | null
          name?: string
          node_id?: string | null
          project_id?: string | null
          source_image_url?: string | null
          style?: string | null
          time_of_day?: Json | null
          updated_at?: string | null
          user_id?: string | null
          weather?: Json | null
          workflow_id?: string | null
        }
        Relationships: []
      }
      model_pricing: {
        Row: {
          category: string | null
          created_at: string | null
          credit_cost: number
          id: string
          is_enabled: boolean | null
          model_identifier: string
          provider_cost_usd: number | null
          tier_restriction: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          credit_cost: number
          id?: string
          is_enabled?: boolean | null
          model_identifier: string
          provider_cost_usd?: number | null
          tier_restriction?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          credit_cost?: number
          id?: string
          is_enabled?: boolean | null
          model_identifier?: string
          provider_cost_usd?: number | null
          tier_restriction?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      objects: {
        Row: {
          angles: Json | null
          category: string | null
          created_at: string | null
          custom_variations: Json | null
          description: string | null
          id: string
          main_image_url: string | null
          materials: Json | null
          name: string
          node_id: string | null
          project_id: string | null
          source_image_url: string | null
          style: string | null
          updated_at: string | null
          user_id: string | null
          variations: Json | null
          workflow_id: string | null
        }
        Insert: {
          angles?: Json | null
          category?: string | null
          created_at?: string | null
          custom_variations?: Json | null
          description?: string | null
          id?: string
          main_image_url?: string | null
          materials?: Json | null
          name: string
          node_id?: string | null
          project_id?: string | null
          source_image_url?: string | null
          style?: string | null
          updated_at?: string | null
          user_id?: string | null
          variations?: Json | null
          workflow_id?: string | null
        }
        Update: {
          angles?: Json | null
          category?: string | null
          created_at?: string | null
          custom_variations?: Json | null
          description?: string | null
          id?: string
          main_image_url?: string | null
          materials?: Json | null
          name?: string
          node_id?: string | null
          project_id?: string | null
          source_image_url?: string | null
          style?: string | null
          updated_at?: string | null
          user_id?: string | null
          variations?: Json | null
          workflow_id?: string | null
        }
        Relationships: []
      }
      paddle_customers: {
        Row: {
          created_at: string | null
          id: string
          paddle_customer_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          paddle_customer_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          paddle_customer_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paddle_customers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          credits_balance: number
          credits_reset_at: string | null
          current_period_end: string | null
          daily_credits_reset_at: string | null
          daily_credits_used: number | null
          daily_spent_credits: number | null
          email: string
          full_name: string | null
          id: string
          last_daily_reset: string | null
          llm_requests_reset_at: string | null
          llm_requests_used: number | null
          prompt_templates: Json | null
          public_outputs: boolean | null
          role: string
          storage_limit_bytes: number | null
          storage_used_bytes: number
          subscription_credits: number | null
          subscription_ended_at: string | null
          subscription_tier: string | null
          tier: string
          topup_credits: number | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          credits_balance?: number
          credits_reset_at?: string | null
          current_period_end?: string | null
          daily_credits_reset_at?: string | null
          daily_credits_used?: number | null
          daily_spent_credits?: number | null
          email: string
          full_name?: string | null
          id: string
          last_daily_reset?: string | null
          llm_requests_reset_at?: string | null
          llm_requests_used?: number | null
          prompt_templates?: Json | null
          public_outputs?: boolean | null
          role?: string
          storage_limit_bytes?: number | null
          storage_used_bytes?: number
          subscription_credits?: number | null
          subscription_ended_at?: string | null
          subscription_tier?: string | null
          tier?: string
          topup_credits?: number | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          credits_balance?: number
          credits_reset_at?: string | null
          current_period_end?: string | null
          daily_credits_reset_at?: string | null
          daily_credits_used?: number | null
          daily_spent_credits?: number | null
          email?: string
          full_name?: string | null
          id?: string
          last_daily_reset?: string | null
          llm_requests_reset_at?: string | null
          llm_requests_used?: number | null
          prompt_templates?: Json | null
          public_outputs?: boolean | null
          role?: string
          storage_limit_bytes?: number | null
          storage_used_bytes?: number
          subscription_credits?: number | null
          subscription_ended_at?: string | null
          subscription_tier?: string | null
          tier?: string
          topup_credits?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_subscription_tier"
            columns: ["subscription_tier"]
            isOneToOne: false
            referencedRelation: "tier_config"
            referencedColumns: ["tier"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          settings: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          settings?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          settings?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      style_presets: {
        Row: {
          created_at: string
          id: string
          is_system: boolean
          name: string
          settings: Json
          thumbnail_url: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          settings?: Json
          thumbnail_url?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          settings?: Json
          thumbnail_url?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "style_presets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at: string | null
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          paddle_customer_id: string | null
          paddle_price_id: string | null
          paddle_subscription_id: string | null
          status: string
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          paddle_customer_id?: string | null
          paddle_price_id?: string | null
          paddle_subscription_id?: string | null
          status: string
          tier: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          paddle_customer_id?: string | null
          paddle_price_id?: string | null
          paddle_subscription_id?: string | null
          status?: string
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_config: {
        Row: {
          created_at: string | null
          daily_credit_limit: number | null
          features: Json | null
          monthly_credits: number
          price_usd: number
          tier: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          daily_credit_limit?: number | null
          features?: Json | null
          monthly_credits: number
          price_usd: number
          tier: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          daily_credit_limit?: number | null
          features?: Json | null
          monthly_credits?: number
          price_usd?: number
          tier?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount_usd: number
          created_at: string | null
          credits_granted: number
          id: string
          paddle_transaction_id: string
          status: string
          tier: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount_usd: number
          created_at?: string | null
          credits_granted?: number
          id?: string
          paddle_transaction_id: string
          status?: string
          tier?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount_usd?: number
          created_at?: string | null
          credits_granted?: number
          id?: string
          paddle_transaction_id?: string
          status?: string
          tier?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_logs: {
        Row: {
          action: string
          cost_usd: number | null
          created_at: string
          credits_charged: number | null
          credits_used: number
          id: string
          job_id: string | null
          metadata: Json | null
          provider: string
          status: string | null
          user_id: string
        }
        Insert: {
          action: string
          cost_usd?: number | null
          created_at?: string
          credits_charged?: number | null
          credits_used: number
          id?: string
          job_id?: string | null
          metadata?: Json | null
          provider: string
          status?: string | null
          user_id: string
        }
        Update: {
          action?: string
          cost_usd?: number | null
          created_at?: string
          credits_charged?: number | null
          credits_used?: number
          id?: string
          job_id?: string | null
          metadata?: Json | null
          provider?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event: string
          id: string
          job_id: string | null
          next_retry_at: string | null
          payload: Json
          response_body: string | null
          response_status: number | null
          webhook_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event: string
          id?: string
          job_id?: string | null
          next_retry_at?: string | null
          payload: Json
          response_body?: string | null
          response_status?: number | null
          webhook_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event?: string
          id?: string
          job_id?: string | null
          next_retry_at?: string | null
          payload?: Json
          response_body?: string | null
          response_status?: number | null
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string
          events: string[]
          id: string
          is_active: boolean
          secret: string | null
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          events?: string[]
          id?: string
          is_active?: boolean
          secret?: string | null
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          events?: string[]
          id?: string
          is_active?: boolean
          secret?: string | null
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_history: {
        Row: {
          created_at: string
          edges: Json
          id: string
          nodes: Json
          version: number
          workflow_id: string
        }
        Insert: {
          created_at?: string
          edges: Json
          id?: string
          nodes: Json
          version: number
          workflow_id: string
        }
        Update: {
          created_at?: string
          edges?: Json
          id?: string
          nodes?: Json
          version?: number
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_history_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          description: string | null
          edges: Json
          folder_id: string | null
          id: string
          is_template: boolean
          name: string
          nodes: Json
          project_id: string
          settings: Json
          source_prompt: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          edges?: Json
          folder_id?: string | null
          id?: string
          is_template?: boolean
          name: string
          nodes?: Json
          project_id: string
          settings?: Json
          source_prompt?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          edges?: Json
          folder_id?: string | null
          id?: string
          is_template?: boolean
          name?: string
          nodes?: Json
          project_id?: string
          settings?: Json
          source_prompt?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workflows_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_subscription_credits: {
        Args: { p_credits: number; p_user_id: string }
        Returns: undefined
      }
      add_topup_credits: {
        Args: { p_credits: number; p_user_id: string }
        Returns: undefined
      }
      check_credits: {
        Args: { p_required_credits: number; p_user_id: string }
        Returns: Json
      }
      check_storage_quota: {
        Args: { p_file_size: number; p_user_id: string }
        Returns: boolean
      }
      commit_credits: {
        Args: { p_actual_credits?: number; p_usage_log_id: string }
        Returns: undefined
      }
      decrement_storage: {
        Args: { p_bytes: number; p_user_id: string }
        Returns: undefined
      }
      deduct_credits: {
        Args: { p_amount: number; p_user_id: string }
        Returns: boolean
      }
      get_my_role: { Args: never; Returns: string }
      get_stats: { Args: { p_user_id?: string }; Returns: Json }
      get_storage_limit_for_tier: { Args: { p_tier: string }; Returns: number }
      get_total_credits: { Args: { p_user_id: string }; Returns: number }
      increment_daily_spent: {
        Args: { p_amount: number; p_user_id: string }
        Returns: undefined
      }
      increment_storage: {
        Args: { p_bytes: number; p_user_id: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      refund_credits: { Args: { p_usage_log_id: string }; Returns: undefined }
      reserve_credits:
        | {
            Args: {
              p_credits: number
              p_display_cost_usd?: number
              p_job_id: string
              p_model_identifier?: string
              p_provider_cost_usd?: number
              p_user_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_credits: number
              p_display_cost_usd: number
              p_job_id: string
              p_model_identifier: string
              p_provider_cost_usd: number
              p_user_id: string
            }
            Returns: string
          }
      reset_daily_spent: { Args: { p_user_id: string }; Returns: undefined }
      share_workflow_assets: {
        Args: { p_workflow_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
