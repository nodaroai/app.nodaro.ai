import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { getAuthHeaders } from "@/lib/api"
import type { AppSettings } from "./use-app-settings-queries"

// --- Types ---
export interface AdminStats {
  readonly totalUsers: number
  readonly totalProjects: number
  readonly totalWorkflows: number
  readonly totalJobs: number
  readonly jobsByStatus: Record<string, number>
  readonly totalCreditsUsed: number
}

export interface AdminUser {
  readonly id: string
  readonly email: string
  readonly full_name: string | null
  readonly subscription_tier: string
  readonly subscription_credits: number
  readonly topup_credits: number
  readonly daily_spent_credits: number
  readonly storage_used_bytes: number
  readonly storage_limit_bytes: number
  readonly role: string
  readonly created_at: string
}

export interface AdminJob {
  readonly id: string
  readonly status: string
  readonly job_type: string | null
  readonly credits: number | null
  readonly provider: string | null
  readonly provider_cost: number | null
  readonly display_cost: number | null
  readonly error_message: string | null
  readonly input_data: Record<string, unknown> | null
  readonly output_data: Record<string, unknown> | null
  readonly created_at: string
  readonly started_at: string | null
  readonly completed_at: string | null
  readonly user_id: string
  readonly user_email: string
  readonly workflow_id: string | null
  readonly workflow_name: string
  readonly workflow_execution_id: string | null
  readonly workflow_project_id: string | null
}

interface AdminUsageLog {
  readonly id: string
  readonly action: string
  readonly provider: string
  readonly credits_used: number
  readonly created_at: string
  readonly user_email: string
}

// --- Queries ---

export function useAdminStats() {
  return useQuery({
    queryKey: queryKeys.admin.stats(),
    queryFn: async (): Promise<AdminStats> => {
      const supabase = createClient()
      const { data, error } = await supabase.rpc("get_admin_stats")
      if (error) throw error
      const stats = data as unknown as {
        totalUsers: number
        totalProjects: number
        totalWorkflows: number
        totalJobs: number
        jobsByStatus: Record<string, number>
        totalCreditsUsed: number
      }
      return {
        totalUsers: stats.totalUsers ?? 0,
        totalProjects: stats.totalProjects ?? 0,
        totalWorkflows: stats.totalWorkflows ?? 0,
        totalJobs: stats.totalJobs ?? 0,
        jobsByStatus: stats.jobsByStatus ?? {},
        totalCreditsUsed: stats.totalCreditsUsed ?? 0,
      }
    },
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useAdminUsers(page: number, pageSize = 50) {
  return useQuery({
    queryKey: queryKeys.admin.users(page, pageSize),
    queryFn: async (): Promise<AdminUser[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, email, full_name, subscription_tier, subscription_credits, topup_credits, daily_spent_credits, storage_used_bytes, storage_limit_bytes, role, created_at",
        )
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        subscription_tier: row.subscription_tier ?? "free",
        subscription_credits: row.subscription_credits ?? 0,
        topup_credits: row.topup_credits ?? 0,
        daily_spent_credits: row.daily_spent_credits ?? 0,
        storage_limit_bytes: row.storage_limit_bytes ?? 524288000,
      }))
    },
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

// workflow_execution_id column exists in DB but not in generated Supabase types
interface JobRow {
  id: string
  status: string
  job_type: string | null
  credits: number | null
  provider: string | null
  provider_cost: number | null
  display_cost: number | null
  error_message: string | null
  input_data: Record<string, unknown> | null
  output_data: Record<string, unknown> | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  user_id: string
  workflow_id: string | null
  workflow_execution_id: string | null
}

export function useAdminJobs(page: number, pageSize = 50, statusFilter?: string) {
  return useQuery({
    queryKey: queryKeys.admin.jobs(page, pageSize, statusFilter),
    queryFn: async (): Promise<AdminJob[]> => {
      const supabase = createClient()
      let query = supabase
        .from("jobs")
        .select("id, status, job_type, credits, provider, provider_cost, display_cost, error_message, input_data, output_data, created_at, started_at, completed_at, user_id, workflow_id, workflow_execution_id") as unknown as {
          order: (col: string, opts: { ascending: boolean }) => typeof query
          range: (from: number, to: number) => typeof query
          eq: (col: string, val: string) => typeof query
          then: Promise<{ data: JobRow[] | null; error: Error | null }>["then"]
        }
      query = query
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (statusFilter) query = query.eq("status", statusFilter)
      const { data: jobs, error } = await (query as unknown as PromiseLike<{ data: JobRow[] | null; error: Error | null }>)
      if (error) throw error
      if (!jobs || jobs.length === 0) return []
      const userIds = [...new Set(jobs.map((j) => j.user_id))]
      const workflowIds = [...new Set(jobs.map((j) => j.workflow_id).filter(Boolean) as string[])]
      const [usersRes, workflowsRes] = await Promise.all([
        supabase.from("profiles").select("id, email").in("id", userIds),
        supabase.from("workflows").select("id, name, project_id").in("id", workflowIds),
      ])
      const userMap = new Map((usersRes.data ?? []).map((u) => [u.id, u.email]))
      const wfMap = new Map((workflowsRes.data ?? []).map((w) => [w.id, { name: w.name, project_id: w.project_id }]))
      return jobs.map((j) => ({
        id: j.id,
        status: j.status,
        job_type: j.job_type ?? null,
        credits: j.credits,
        provider: j.provider ?? null,
        provider_cost: j.provider_cost ?? null,
        display_cost: j.display_cost ?? null,
        error_message: j.error_message ?? null,
        input_data: (j.input_data ?? null) as Record<string, unknown> | null,
        output_data: (j.output_data ?? null) as Record<string, unknown> | null,
        created_at: j.created_at,
        started_at: j.started_at ?? null,
        completed_at: j.completed_at ?? null,
        user_id: j.user_id,
        user_email: userMap.get(j.user_id) ?? "Unknown",
        workflow_id: j.workflow_id ?? null,
        workflow_name: wfMap.get(j.workflow_id ?? "")?.name ?? "Unknown",
        workflow_execution_id: j.workflow_execution_id ?? null,
        workflow_project_id: wfMap.get(j.workflow_id ?? "")?.project_id ?? null,
      }))
    },
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

// published_apps and app_runs tables exist in DB but not in generated Supabase types
interface AppRow {
  id: string
  name: string
  slug: string
  workflow_id: string
  creator_id: string
  icon_url: string | null
  version: number
  is_active: boolean
  is_listed: boolean
  estimated_credits: number | null
  created_at: string
  thumbnail_node_id: string | null
}

export interface AdminApp extends AppRow {
  readonly creator_email: string
  readonly run_count: number
  readonly workflow_project_id: string | null
}

export function useAdminApps(page: number, pageSize = 50) {
  return useQuery({
    queryKey: queryKeys.admin.apps(page, pageSize),
    queryFn: async () => {
      const supabase = createClient()
      const { data, error } = await (supabase
        .from("published_apps" as "assets")
        .select("id, name, slug, workflow_id, creator_id, icon_url, version, is_active, is_listed, estimated_credits, created_at, thumbnail_node_id") as unknown as PromiseLike<{ data: AppRow[] | null; error: Error | null }>)
      if (error) throw error
      if (!data || data.length === 0) return []
      const creatorIds = [...new Set(data.map((a) => a.creator_id).filter(Boolean))]
      const workflowIds = [...new Set(data.map((a) => a.workflow_id).filter(Boolean))]
      const [creatorsRes, workflowsRes] = await Promise.all([
        supabase.from("profiles").select("id, email").in("id", creatorIds),
        supabase.from("workflows").select("id, project_id").in("id", workflowIds),
      ])
      const creatorMap = new Map((creatorsRes.data ?? []).map((c) => [c.id, c.email]))
      const wfMap = new Map((workflowsRes.data ?? []).map((w) => [w.id, w.project_id]))
      const appIds = data.map((a) => a.id)
      const { data: runs } = await (supabase
        .from("app_runs" as "assets")
        .select("app_id, count")
        .in("app_id", appIds) as unknown as PromiseLike<{ data: { app_id: string; count: number }[] | null; error: Error | null }>)
      const runMap = new Map((runs ?? []).map((r) => [r.app_id, r.count]))
      return data.map((a) => ({
        ...a,
        creator_email: creatorMap.get(a.creator_id) ?? "Unknown",
        run_count: runMap.get(a.id) ?? 0,
        workflow_project_id: wfMap.get(a.workflow_id) ?? null,
      }))
    },
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

export function useAdminUsageLogs(page: number, pageSize = 50) {
  return useQuery({
    queryKey: queryKeys.admin.usageLogs(page, pageSize),
    queryFn: async (): Promise<AdminUsageLog[]> => {
      const supabase = createClient()
      const { data: logs, error } = await supabase
        .from("usage_logs")
        .select("id, action, provider, credits_used, created_at, user_id")
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) throw error
      if (!logs || logs.length === 0) return []
      const userIds = [...new Set(logs.map((l) => l.user_id))]
      const { data: users } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", userIds)
      const userMap = new Map((users ?? []).map((u) => [u.id, u.email]))
      return logs.map((l) => ({
        id: l.id,
        action: l.action,
        provider: l.provider,
        credits_used: l.credits_used,
        created_at: l.created_at,
        user_email: userMap.get(l.user_id) ?? "Unknown",
      }))
    },
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

export function useAdminModels() {
  return useQuery({
    queryKey: queryKeys.admin.models(),
    queryFn: async () => {
      const res = await fetch(`/v1/admin/models`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch models")
      return res.json() as Promise<{ data: unknown[] }>
    },
    enabled: hasAdmin(),
    staleTime: 60_000,
  })
}

export function useAdminReports(page: number, status?: string) {
  return useQuery({
    queryKey: queryKeys.admin.reports(page, status),
    queryFn: async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const params = new URLSearchParams({
        userId: session?.user?.id ?? "",
        page: String(page),
        limit: "20",
      })
      if (status) params.set("status", status)
      const res = await fetch(`/v1/admin/gallery-reports?${params.toString()}`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch reports")
      return res.json()
    },
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

export function useAdminAlerts() {
  return useQuery({
    queryKey: queryKeys.admin.alerts(),
    queryFn: async () => {
      const res = await fetch(`/v1/admin/alerts`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch alerts")
      return res.json()
    },
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useAdminSettings() {
  return useQuery({
    queryKey: queryKeys.admin.settings(),
    queryFn: async (): Promise<AppSettings> => {
      const res = await fetch(`/v1/admin/settings`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch settings")
      const data = await res.json()
      const settings = data.settings as Record<string, unknown>
      return {
        ai_provider: (settings.ai_provider as "replicate" | "kie") ?? "replicate",
        cost_markup_percent: (settings.cost_markup_percent as number) ?? 25,
        apps_video_autoplay: (settings.apps_video_autoplay as boolean) ?? true,
        featured_app_ids: (Array.isArray(settings.featured_app_ids) ? settings.featured_app_ids : []) as string[],
        featured_apps_limit: (settings.featured_apps_limit as number) ?? 20,
      }
    },
    enabled: hasAdmin(),
    staleTime: 60_000,
  })
}

export function useAdminUserTransactions(userId: string) {
  return useQuery({
    queryKey: queryKeys.admin.userTransactions(userId),
    queryFn: async () => {
      const res = await fetch(`/v1/admin/users/${userId}/transactions?limit=20`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch transactions")
      return res.json()
    },
    enabled: hasAdmin() && !!userId,
    staleTime: 30_000,
  })
}

// --- Mutations ---

export function useUpdateModelPricingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ modelId, pricing }: { modelId: string; pricing: unknown }) => {
      const res = await fetch(`/v1/admin/models/${modelId}/pricing`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify(pricing),
      })
      if (!res.ok) throw new Error("Failed to update pricing")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.models() })
    },
  })
}

export function useAdminAdjustCreditsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { userId: string; amount: number; type: string }) => {
      const res = await fetch(`/v1/admin/users/${params.userId}/credits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify({ amount: params.amount, type: params.type }),
      })
      if (!res.ok) throw new Error("Failed to adjust credits")
      return res.json()
    },
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] })
      qc.invalidateQueries({ queryKey: queryKeys.admin.userTransactions(userId) })
    },
  })
}

export function useResolveReportMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ reportId, action }: { reportId: string; action: string }) => {
      const res = await fetch(`/v1/admin/gallery-reports/${reportId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error("Failed to resolve report")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "reports"] })
      qc.invalidateQueries({ queryKey: queryKeys.gallery.reportCount() })
      qc.invalidateQueries({ queryKey: queryKeys.gallery.all })
    },
  })
}

export function useCreateAlertMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (alert: Record<string, unknown>) => {
      const res = await fetch(`/v1/admin/alerts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify(alert),
      })
      if (!res.ok) throw new Error("Failed to create alert")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.alerts() })
    },
  })
}

export function useUpdateAlertMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Record<string, unknown>) => {
      const res = await fetch(`/v1/admin/alerts/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error("Failed to update alert")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.alerts() })
    },
  })
}

export function useDeleteAlertMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/v1/admin/alerts/${id}`, {
        method: "DELETE",
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to delete alert")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.alerts() })
    },
  })
}

export function useAdminChangeTierMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, tier }: { userId: string; tier: string }) => {
      const res = await fetch(`/v1/admin/users/${userId}/tier`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify({ tier }),
      })
      if (!res.ok) throw new Error("Failed to change tier")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useAdminChangeStorageMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, storageLimitBytes }: { userId: string; storageLimitBytes: number }) => {
      const res = await fetch(`/v1/admin/users/${userId}/storage`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify({ storageLimitBytes }),
      })
      if (!res.ok) throw new Error("Failed to change storage limit")
      return res.json()
    },
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] })
      qc.invalidateQueries({ queryKey: queryKeys.billing.storage(userId) })
    },
  })
}

export function useAdminChangeRoleMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await fetch(`/v1/admin/users/${userId}/role`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) throw new Error("Failed to change role")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

// --- Credit Anomaly Types ---
export interface CreditAnomaly {
  readonly id: string
  readonly created_at: string
  readonly job_id: string | null
  readonly user_id: string
  readonly user_email: string
  readonly model_identifier: string
  readonly provider: string | null
  readonly credits_estimated: number
  readonly credits_actual: number
  readonly diff: number
  readonly provider_cost_usd: number | null
  readonly anomaly_type: "overcharge" | "undercharge" | "unknown_model" | "zero_cost"
  readonly status: "pending" | "acknowledged" | "dismissed"
  readonly admin_notes: string | null
  readonly resolved_at: string | null
}

export interface AnomalySummary {
  readonly pending: number
  readonly totalOvercharge: number
  readonly totalUndercharge: number
  readonly total: number
}

// --- Credit Anomaly Queries ---

export function useAdminCreditAnomaliesSummary() {
  return useQuery({
    queryKey: queryKeys.admin.creditAnomaliesSummary(),
    queryFn: async (): Promise<AnomalySummary> => {
      const res = await fetch("/v1/admin/credit-anomalies/summary", {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch summary")
      return res.json()
    },
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useAdminCreditAnomalies(offset: number, status: string, anomalyType: string, model: string) {
  return useQuery({
    queryKey: queryKeys.admin.creditAnomalies(offset, status, anomalyType, model),
    queryFn: async (): Promise<{ data: CreditAnomaly[]; total: number }> => {
      const params = new URLSearchParams({ offset: String(offset), limit: "50" })
      if (status !== "all") params.set("status", status)
      if (anomalyType !== "all") params.set("anomalyType", anomalyType)
      if (model.trim()) params.set("model", model.trim())
      const res = await fetch(`/v1/admin/credit-anomalies?${params}`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch anomalies")
      return res.json()
    },
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

// --- Credit Anomaly Mutations ---

export function usePatchCreditAnomalyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "acknowledged" | "dismissed" }) => {
      const res = await fetch(`/v1/admin/credit-anomalies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error("Failed to update anomaly")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "credit-anomalies"] })
    },
  })
}

export function useDeleteCreditAnomalyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/v1/admin/credit-anomalies/${id}`, {
        method: "DELETE",
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to delete anomaly")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "credit-anomalies"] })
    },
  })
}

// --- LLM Models ---

export interface AdminLlmModel {
  readonly id: string
  readonly displayName: string
  readonly tier: "economy" | "standard" | "premium"
  readonly vendor: "anthropic" | "google" | "openai"
  readonly isEnabled: boolean
}

export interface AdminLlmModelsResponse {
  readonly models: AdminLlmModel[]
  readonly tierCosts: { economy: number | null; standard: number | null; premium: number | null }
  readonly featureCosts: Record<string, { economy: number | null; standard: number | null; premium: number | null }>
}

export function useAdminLlmModels() {
  return useQuery({
    queryKey: queryKeys.admin.llmModels(),
    queryFn: async (): Promise<AdminLlmModelsResponse> => {
      const res = await fetch("/v1/admin/llm-models", {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch LLM models")
      const json = await res.json()
      return (json.data ?? { models: [], tierCosts: {}, featureCosts: {} }) as AdminLlmModelsResponse
    },
    enabled: hasAdmin(),
    staleTime: 60_000,
  })
}

export function useToggleLlmModelMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ modelId, isEnabled }: { modelId: string; isEnabled: boolean }) => {
      const res = await fetch(`/v1/admin/llm-models/${modelId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify({ isEnabled }),
      })
      if (!res.ok) throw new Error("Failed to update LLM model")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.llmModels() })
    },
  })
}
