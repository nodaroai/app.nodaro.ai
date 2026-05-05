import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import {
  getAuthHeaders,
  fetchAdminNodeDefaults,
  updateAdminNodeDefault,
  deleteAdminNodeDefault,
} from "@/lib/api"
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

export type UsageGroupBy =
  | "none"
  | "user"
  | "action"
  | "day"
  | "user-action"
  | "user-day"
  | "action-day"

export type UsageSortBy = "created_at" | "credits_used" | "log_count"

export type SortDir = "asc" | "desc"

export interface AdminUsageLog {
  readonly id: string
  readonly user_id: string | null
  readonly user_email: string | null
  readonly action: string | null
  readonly provider: string | null
  readonly day: string | null
  readonly credits_used: number
  readonly log_count: number
  readonly created_at: string | null
}

export type UserSortBy =
  | "email"
  | "tier"
  | "subscription_credits"
  | "topup_credits"
  | "total_credits"
  | "daily_spent_credits"
  | "role"
  | "created_at"

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

// Map UI sort keys to actual profile column names. Keep at module scope so it
// doesn't allocate per render.
const USER_SORT_COLUMN: Record<UserSortBy, string> = {
  email: "email",
  tier: "subscription_tier",
  subscription_credits: "subscription_credits",
  topup_credits: "topup_credits",
  total_credits: "total_credits",
  daily_spent_credits: "daily_spent_credits",
  role: "role",
  created_at: "created_at",
}

// Default direction when activating each sort: text fields ascend, numbers/dates descend.
export const USER_SORT_DEFAULT_DIR: Record<UserSortBy, SortDir> = {
  email: "asc",
  tier: "asc",
  role: "asc",
  subscription_credits: "desc",
  topup_credits: "desc",
  total_credits: "desc",
  daily_spent_credits: "desc",
  created_at: "desc",
}

export function useAdminUsers(
  page: number,
  pageSize = 50,
  sortBy: UserSortBy = "created_at",
  sortDir: SortDir = "desc",
) {
  return useQuery({
    queryKey: queryKeys.admin.users(page, pageSize, sortBy, sortDir),
    queryFn: async (): Promise<AdminUser[]> => {
      const supabase = createClient()
      const sortColumn = USER_SORT_COLUMN[sortBy] ?? "created_at"
      const ascending = sortDir === "asc"
      // total_credits is a generated column added in migration 099 — Supabase's
      // generated TS types don't see it, so cast through unknown to keep the
      // typed response shape we use below.
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, email, full_name, subscription_tier, subscription_credits, topup_credits, daily_spent_credits, storage_used_bytes, storage_limit_bytes, role, created_at",
        )
        .order(sortColumn, { ascending, nullsFirst: false })
        // Stable secondary sort so paginated rows don't shift around between pages.
        .order("id", { ascending: true })
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

export function useAdminJobs(
  page: number,
  pageSize = 50,
  statusFilter?: string,
  userIdFilter?: string,
) {
  return useQuery({
    queryKey: queryKeys.admin.jobs(page, pageSize, statusFilter, userIdFilter),
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
      if (userIdFilter) query = query.eq("user_id", userIdFilter)
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

const ADMIN_USER_FILTER_LIMIT = 1000

export function useAllAdminUsersLite() {
  return useQuery({
    queryKey: queryKeys.admin.usersLite(),
    queryFn: async (): Promise<ReadonlyArray<{ id: string; email: string }>> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email")
        .order("email", { ascending: true })
        .limit(ADMIN_USER_FILTER_LIMIT)
      if (error) throw error
      return (data ?? []) as ReadonlyArray<{ id: string; email: string }>
    },
    enabled: hasAdmin(),
    staleTime: 60_000,
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

// Shape returned by the get_admin_usage_logs RPC (migration 099).
interface UsageLogRpcRow {
  id: string
  user_id: string | null
  user_email: string | null
  action: string | null
  provider: string | null
  day: string | null
  credits_used: number | string
  log_count: number | string
  created_at: string | null
}

export function useAdminUsageLogs(
  page: number,
  pageSize = 50,
  groupBy: UsageGroupBy = "none",
  sortBy: UsageSortBy = "created_at",
  sortDir: SortDir = "desc",
) {
  return useQuery({
    queryKey: queryKeys.admin.usageLogs(page, pageSize, groupBy, sortBy, sortDir),
    queryFn: async (): Promise<AdminUsageLog[]> => {
      const supabase = createClient()
      // get_admin_usage_logs is added by migration 099 — generated types lag
      // behind the migration, so cast the RPC name (and result) through unknown.
      const { data, error } = await supabase.rpc(
        "get_admin_usage_logs" as unknown as "get_admin_stats",
        {
          p_group_by: groupBy,
          p_sort_by: sortBy,
          p_sort_dir: sortDir,
          p_limit: pageSize,
          p_offset: page * pageSize,
        } as unknown as Record<string, never>,
      )
      if (error) throw error
      const rows = (data ?? []) as unknown as UsageLogRpcRow[]
      // Postgres BIGINT comes back as a string in the JSON payload; coerce to
      // number once at the boundary so consumers don't have to.
      return rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        user_email: r.user_email,
        action: r.action,
        provider: r.provider,
        day: r.day,
        credits_used: typeof r.credits_used === "string" ? Number(r.credits_used) : r.credits_used,
        log_count: typeof r.log_count === "string" ? Number(r.log_count) : r.log_count,
        created_at: r.created_at,
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
        carousel_video_autoplay: (settings.carousel_video_autoplay as boolean) ?? true,
        apps_page_video_autoplay: (settings.apps_page_video_autoplay as boolean) ?? true,
        featured_app_ids: (Array.isArray(settings.featured_app_ids) ? settings.featured_app_ids : []) as string[],
        featured_apps_limit: (settings.featured_apps_limit as number) ?? 20,
        apps_auto_scroll_seconds: (settings.apps_auto_scroll_seconds as number) ?? 4,
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
    mutationFn: async (params: { userId: string; amount: number; creditType: string; description: string; adminUserId: string }) => {
      const res = await fetch(`/v1/admin/users/${params.userId}/credits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify({ amount: params.amount, creditType: params.creditType, description: params.description, adminUserId: params.adminUserId }),
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

// ──────────────────────────────────────────────────────────────────────────
// Node defaults (admin)
// ──────────────────────────────────────────────────────────────────────────

export function useAdminNodeDefaults() {
  return useQuery({
    queryKey: queryKeys.admin.nodeDefaults(),
    queryFn: fetchAdminNodeDefaults,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useUpdateNodeDefaultMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      nodeType: string
      provider: string
      qualityLevel?: string | null
      aspectRatio?: string | null
    }) =>
      updateAdminNodeDefault(args.nodeType, {
        provider: args.provider,
        qualityLevel: args.qualityLevel,
        aspectRatio: args.aspectRatio,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.nodeDefaults() })
      qc.invalidateQueries({ queryKey: queryKeys.nodeDefaults.all })
    },
  })
}

export function useResetNodeDefaultMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteAdminNodeDefault,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.nodeDefaults() })
      qc.invalidateQueries({ queryKey: queryKeys.nodeDefaults.all })
    },
  })
}
