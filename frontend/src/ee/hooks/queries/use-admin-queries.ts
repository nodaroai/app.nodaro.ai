import {
  useQuery,
  useInfiniteQuery,
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

/**
 * The server's own message, when it has one to give.
 *
 * These hooks all threw a hardcoded string, so a refusal that took the trouble
 * to explain itself — the platform-operator gate's `operator_required`, which
 * tells an admin that adminship alone is not enough on this deployment — reached
 * the screen as "Failed to adjust credits". The fallback stays for responses
 * with no body (a proxy 502, a network-shaped failure).
 */
async function adminError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  return new Error(body?.error?.message || fallback)
}
import type { AppSettings } from "@/hooks/queries/use-app-settings-queries"

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
  /** Which surface created the job — mcp | web | cli | sdk | app | api |
   *  internal. Null for rows predating migration 282. */
  readonly source: string | null
  /** Specific identity within `source`: MCP client name, browser origin host,
   *  client package/version, or developer-app id. */
  readonly source_detail: string | null
  /** Resolved display name when source='app' (source_detail is the app's id).
   *  Null when the app row is gone (DCR sweep) — the badge shows the raw id. */
  readonly source_app_name: string | null
  readonly workflow_project_id: string | null
  /** Set by Phase 1 reconciliation: which upstream provider type was called. */
  readonly provider_kind: string | null
  /** Persisted upstream task ID — used by reconcile cron to recover stuck jobs. */
  readonly provider_task_id: string | null
  /** Times the reconcile cron has tried (and failed) to recover this job.
   *  Force-fails at MAX_ATTEMPTS=18 (Phase 5). */
  readonly reconcile_attempts: number
  readonly reconcile_last_error: string | null
  readonly provider_call_started_at: string | null
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
          // `tier` too: the Stripe paths write only `tier`, so reading
          // `subscription_tier` alone showed paying customers as "free".
          "id, email, full_name, tier, subscription_tier, subscription_credits, topup_credits, daily_spent_credits, storage_used_bytes, storage_limit_bytes, role, created_at",
        )
        .order(sortColumn, { ascending, nullsFirst: false })
        // Stable secondary sort so paginated rows don't shift around between pages.
        .order("id", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        // Same precedence credit enforcement uses (backend tier-columns.ts).
        subscription_tier: row.tier ?? row.subscription_tier ?? "free",
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
  source: string | null
  source_detail: string | null
  provider_kind: string | null
  provider_task_id: string | null
  reconcile_attempts: number | null
  reconcile_last_error: string | null
  provider_call_started_at: string | null
}

// Fetch + client-side enrich ONE page of admin jobs. Extracted verbatim from
// useAdminJobs so the table (useAdminJobs) and the Gallery
// (useAdminJobsInfinite) share exactly one fetch/enrichment implementation.
async function fetchAdminJobsPage(
  page: number,
  pageSize: number,
  statusFilter?: string,
  userIdFilter?: string,
  excludeUserIds?: ReadonlyArray<string>,
): Promise<AdminJob[]> {
  const supabase = createClient()
  // `jobs` is no longer column-readable from the browser: migration 347
  // revoked table-level SELECT from `authenticated` down to the four columns
  // Realtime needs, so provider_cost / display_cost (and 17 other fields
  // this table renders) are service-role-only. The listing comes over REST
  // from GET /v1/admin/jobs (requireAdmin). The enrichment reads below are
  // unaffected — those tables keep their admin RLS policies.
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (statusFilter) params.set("status", statusFilter)
  if (userIdFilter) params.set("userId", userIdFilter)
  if (excludeUserIds && excludeUserIds.length > 0) {
    params.set("excludeUserIds", excludeUserIds.join(","))
  }
  const res = await fetch(`/v1/admin/jobs?${params.toString()}`, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) throw await adminError(res, "Failed to fetch jobs")
  const { data: jobs } = (await res.json()) as { data: JobRow[] }
  if (!jobs || jobs.length === 0) return []
  const userIds = [...new Set(jobs.map((j) => j.user_id))]
  // Orchestrator-created rows carry only workflow_execution_id (their
  // workflow_id is null), so the owning workflow is resolved through the
  // execution row — otherwise the Workflow column has nothing to link.
  const executionIds = [
    ...new Set(jobs.filter((j) => !j.workflow_id && j.workflow_execution_id).map((j) => j.workflow_execution_id as string)),
  ]
  // source='app' rows store the developer-app ID in source_detail (it is a
  // query key for credit-guard/connected-instances, so the stored value
  // stays an id). Resolve the display name here; a miss stays null — the
  // app may have been deleted (DCR sweep) — and the badge shows the id.
  const appIds = [
    ...new Set(jobs.filter((j) => j.source === "app" && j.source_detail).map((j) => j.source_detail as string)),
  ]
  // The two `as never` / `as unknown as` casts mirror the jobs query above:
  // the generated Database type predates these tables.
  const [usersRes, executionsRes, appsRes] = await Promise.all([
    supabase.from("profiles").select("id, email").in("id", userIds),
    supabase.from("workflow_executions" as never).select("id, workflow_id").in("id", executionIds) as unknown as PromiseLike<{
      data: Array<{ id: string; workflow_id: string | null }> | null
    }>,
    supabase.from("developer_apps" as never).select("id, name").in("id", appIds) as unknown as PromiseLike<{
      data: Array<{ id: string; name: string }> | null
    }>,
  ])
  const execWfMap = new Map((executionsRes.data ?? []).map((e) => [e.id, e.workflow_id]))
  const appNameMap = new Map((appsRes.data ?? []).map((a) => [a.id, a.name]))
  const resolveWorkflowId = (j: JobRow): string | null =>
    j.workflow_id ?? (j.workflow_execution_id ? (execWfMap.get(j.workflow_execution_id) ?? null) : null)
  const workflowIds = [...new Set(jobs.map(resolveWorkflowId).filter(Boolean) as string[])]
  const workflowsRes = await supabase.from("workflows").select("id, name, project_id").in("id", workflowIds)
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
    workflow_id: resolveWorkflowId(j),
    workflow_name: wfMap.get(resolveWorkflowId(j) ?? "")?.name ?? "Unknown",
    workflow_execution_id: j.workflow_execution_id ?? null,
    workflow_project_id: wfMap.get(resolveWorkflowId(j) ?? "")?.project_id ?? null,
    source: j.source ?? null,
    source_detail: j.source_detail ?? null,
    source_app_name: j.source === "app" && j.source_detail ? (appNameMap.get(j.source_detail) ?? null) : null,
    provider_kind: j.provider_kind ?? null,
    provider_task_id: j.provider_task_id ?? null,
    reconcile_attempts: j.reconcile_attempts ?? 0,
    reconcile_last_error: j.reconcile_last_error ?? null,
    provider_call_started_at: j.provider_call_started_at ?? null,
  }))
}

export function useAdminJobs(
  page: number,
  pageSize = 50,
  statusFilter?: string,
  userIdFilter?: string,
  excludeUserIds?: ReadonlyArray<string>,
) {
  return useQuery({
    queryKey: queryKeys.admin.jobs(page, pageSize, statusFilter, userIdFilter, excludeUserIds),
    queryFn: () => fetchAdminJobsPage(page, pageSize, statusFilter, userIdFilter, excludeUserIds),
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

/**
 * Infinite (Gallery view) counterpart of useAdminJobs — same fetch + per-page
 * client-side enrichment, paged by offset. refetchOnWindowFocus is OFF: each
 * page fans out several Supabase enrichment reads, so a focus refetch of every
 * loaded page would be a burst of dozens of queries. Flatten `pages` deduped by
 * id at the call site — offset paging over a live created_at-desc table repeats
 * a row across page boundaries when new jobs land mid-scroll.
 */
export function useAdminJobsInfinite(
  pageSize = 50,
  statusFilter?: string,
  userIdFilter?: string,
  excludeUserIds?: ReadonlyArray<string>,
) {
  return useInfiniteQuery({
    queryKey: queryKeys.admin.jobsInfinite(pageSize, statusFilter, userIdFilter, excludeUserIds),
    queryFn: ({ pageParam }) =>
      fetchAdminJobsPage(pageParam, pageSize, statusFilter, userIdFilter, excludeUserIds),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length === pageSize ? allPages.length : undefined),
    enabled: hasAdmin(),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })
}

const ADMIN_USER_FILTER_LIMIT = 1000

export interface AdminUserLite {
  readonly id: string
  readonly email: string
  readonly fullName: string | null
  readonly role: "user" | "admin" | "super_admin"
}

export function useAllAdminUsersLite(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.admin.usersLite(),
    queryFn: async (): Promise<ReadonlyArray<AdminUserLite>> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, role")
        .limit(ADMIN_USER_FILTER_LIMIT)
      if (error) throw error
      const users = (data ?? []).map((row) => ({
        id: row.id as string,
        email: row.email as string,
        fullName: (row.full_name as string | null) ?? null,
        role: (row.role as "user" | "admin" | "super_admin") ?? "user",
      }))
      return [...users].sort((a, b) =>
        a.email.localeCompare(b.email, undefined, { sensitivity: "base" }),
      )
    },
    enabled: hasAdmin() && (options.enabled ?? true),
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
  deleted_at: string | null
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
        .select("id, name, slug, workflow_id, creator_id, icon_url, version, is_active, is_listed, estimated_credits, created_at, thumbnail_node_id, deleted_at") as unknown as PromiseLike<{ data: AppRow[] | null; error: Error | null }>)
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
      if (!res.ok) throw await adminError(res, "Failed to fetch models")
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
      if (!res.ok) throw await adminError(res, "Failed to fetch reports")
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
      if (!res.ok) throw await adminError(res, "Failed to fetch alerts")
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
      if (!res.ok) throw await adminError(res, "Failed to fetch settings")
      const data = await res.json()
      const settings = data.settings as Record<string, unknown>
      return {
        ai_provider: (settings.ai_provider as "replicate" | "kie") ?? "replicate",
        cost_markup_percent: (settings.cost_markup_percent as number) ?? 0,
        carousel_video_autoplay: (settings.carousel_video_autoplay as boolean) ?? true,
        apps_page_video_autoplay: (settings.apps_page_video_autoplay as boolean) ?? true,
        // The runtime copilot pause. Defaults to true, matching the seed and
        // the backend's own default — an ABSENT row means on, so a fresh
        // install shows the switch on rather than off.
        copilot_enabled: (settings.copilot_enabled as boolean) ?? true,
        copilot_default_tier: (settings.copilot_default_tier as string) ?? "",
        copilot_tier_caps: (settings.copilot_tier_caps && typeof settings.copilot_tier_caps === "object"
          ? settings.copilot_tier_caps
          : {}) as AppSettings["copilot_tier_caps"],
        featured_app_ids: (Array.isArray(settings.featured_app_ids) ? settings.featured_app_ids : []) as string[],
        featured_apps_limit: (settings.featured_apps_limit as number) ?? 20,
        apps_auto_scroll_seconds: (settings.apps_auto_scroll_seconds as number) ?? 4,
        // Consent knobs — the admin settings page reads these off THIS hook, so
        // they must be mapped here (not only in fetchAppSettings) or the card
        // shows defaults forever and never reflects a saved value.
        consent_enabled: (settings.consent_enabled as boolean | undefined) ?? false,
        consent_cadence_hours: (settings.consent_cadence_hours as number | undefined) ?? 24,
        consent_max_asks: (settings.consent_max_asks as number | undefined) ?? 5,
        consent_withdrawn_cadence_hours: (settings.consent_withdrawn_cadence_hours as number | undefined) ?? 720,
        consent_login_definition: (settings.consent_login_definition as "session" | "app_open" | undefined) ?? "session",
        consent_text: (settings.consent_text as string | undefined) ?? "",
        consent_version: (settings.consent_version as number | undefined) ?? 1,
        // Internal founder-notification knobs (same reasoning as consent above).
        notify_digest_enabled: (settings.notify_digest_enabled as boolean | undefined) ?? true,
        notify_digest_hour: (settings.notify_digest_hour as number | undefined) ?? 8,
        notify_milestones_enabled: (settings.notify_milestones_enabled as boolean | undefined) ?? true,
        notify_every_signup_enabled: (settings.notify_every_signup_enabled as boolean | undefined) ?? false,
        notify_slack_webhook_url: (settings.notify_slack_webhook_url as string | undefined) ?? "",
      }
    },
    enabled: hasAdmin(),
    staleTime: 60_000,
  })
}

export interface AdminUserSubscription {
  readonly id: string
  readonly stripe_subscription_id: string
  readonly tier: string
  readonly status: string
  readonly current_period_start: string | null
  readonly current_period_end: string | null
  readonly cancel_at_period_end: boolean | null
  readonly cancel_at: string | null
  readonly canceled_at: string | null
  readonly created_at: string
}

export function useAdminUserSubscription(userId: string) {
  return useQuery({
    queryKey: queryKeys.admin.userSubscription(userId),
    queryFn: async (): Promise<AdminUserSubscription | null> => {
      const res = await fetch(`/v1/admin/users/${userId}/subscription`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw await adminError(res, "Failed to fetch subscription")
      const json = await res.json()
      return json.data ?? null
    },
    enabled: hasAdmin() && !!userId,
    staleTime: 30_000,
  })
}

export function useAdminUserTransactions(userId: string) {
  return useQuery({
    queryKey: queryKeys.admin.userTransactions(userId),
    queryFn: async () => {
      const res = await fetch(`/v1/admin/users/${userId}/transactions?limit=20`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw await adminError(res, "Failed to fetch transactions")
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
      if (!res.ok) throw await adminError(res, "Failed to update pricing")
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
      if (!res.ok) throw await adminError(res, "Failed to adjust credits")
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
      if (!res.ok) throw await adminError(res, "Failed to resolve report")
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
      if (!res.ok) throw await adminError(res, "Failed to create alert")
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
      if (!res.ok) throw await adminError(res, "Failed to update alert")
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
      if (!res.ok) throw await adminError(res, "Failed to delete alert")
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
      if (!res.ok) throw await adminError(res, "Failed to change tier")
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
      if (!res.ok) throw await adminError(res, "Failed to change storage limit")
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
      if (!res.ok) throw await adminError(res, "Failed to change role")
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
      if (!res.ok) throw await adminError(res, "Failed to fetch summary")
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
      if (!res.ok) throw await adminError(res, "Failed to fetch anomalies")
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
      if (!res.ok) throw await adminError(res, "Failed to update anomaly")
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
      if (!res.ok) throw await adminError(res, "Failed to delete anomaly")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "credit-anomalies"] })
    },
  })
}

// --- Picker Catalog Gaps ---
export interface PickerGap {
  readonly id: string
  readonly picker_type: string
  readonly gap_type: "item" | "category"
  readonly dimension: string
  readonly observed: string
  readonly chosen_id: string | null
  readonly count: number
  readonly status: "new" | "reviewed" | "added" | "dismissed"
  readonly first_seen: string
  readonly last_seen: string
}

/** Shared by the list hook and the .md export (which pages through ALL rows). */
export async function fetchAdminPickerGapsPage(
  offset: number,
  limit: number,
  picker: string,
  gapType: string,
  status: string,
): Promise<{ data: PickerGap[]; total: number }> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (picker !== "all") params.set("picker", picker)
  if (gapType !== "all") params.set("gapType", gapType)
  if (status !== "all") params.set("status", status)
  const res = await fetch(`/v1/admin/picker-gaps?${params}`, { headers: await getAuthHeaders() })
  if (!res.ok) throw await adminError(res, "Failed to fetch picker gaps")
  return res.json()
}

export function useAdminPickerGaps(offset: number, picker: string, gapType: string, status: string) {
  return useQuery({
    queryKey: queryKeys.admin.pickerGaps(offset, picker, gapType, status),
    queryFn: () => fetchAdminPickerGapsPage(offset, 50, picker, gapType, status),
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

export function usePatchPickerGapMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PickerGap["status"] }) => {
      const res = await fetch(`/v1/admin/picker-gaps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw await adminError(res, "Failed to update gap")
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "picker-gaps"] }),
  })
}

// --- App Reports (generic diagnostic inbox) ---

/** Originating-job context resolved server-side (all best-effort / nullable):
 *  jobs provenance (`source`/`source_detail`, migration 282), the execution's
 *  trigger + MCP client for orchestrated jobs, and the published app's slug
 *  when the run came from an app. */
export interface AppReportJobInfo {
  readonly status: string | null
  readonly model_identifier: string | null
  readonly provider: string | null
  readonly error_message: string | null
  readonly source: string | null
  readonly source_detail: string | null
  readonly workflow_execution_id: string | null
  readonly execution_trigger: string | null
  readonly mcp_client: string | null
  readonly app_slug: string | null
}

/** Execution context for execution-keyed reports (kind execution-failure):
 *  the run's trigger, MCP client, and the published app's slug when the run
 *  came from an app. */
export interface AppReportExecutionInfo {
  readonly trigger_type: string | null
  readonly mcp_client: string | null
  readonly app_slug: string | null
}

export interface AppReport {
  readonly id: string
  readonly app_slug: string | null
  readonly node: string
  readonly kind: string
  readonly severity: "info" | "warning" | "error"
  readonly title: string
  readonly payload: Record<string, unknown>
  readonly user_id: string | null
  readonly user_email: string | null
  readonly job_id: string | null
  readonly job: AppReportJobInfo | null
  readonly execution_id: string | null
  readonly execution: AppReportExecutionInfo | null
  readonly status: "new" | "reviewed" | "resolved" | "dismissed"
  readonly created_at: string
}

/** User scoping for the reports list — same three modes as the jobs page's
 *  UserFilter: everything, one user, or everyone except admins. */
export interface AppReportsUserScope {
  readonly userId?: string
  readonly excludeUserIds?: ReadonlyArray<string>
}

/** Shared by the list hook and the .md export (which pages through ALL rows). */
export async function fetchAdminAppReportsPage(
  offset: number,
  limit: number,
  kind: string,
  appSlug: string,
  status: string,
  userScope: AppReportsUserScope = {},
): Promise<{ data: AppReport[]; total: number }> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (kind !== "all") params.set("kind", kind)
  if (appSlug !== "all") params.set("appSlug", appSlug)
  if (status !== "all") params.set("status", status)
  if (userScope.userId) params.set("userId", userScope.userId)
  if (userScope.excludeUserIds && userScope.excludeUserIds.length > 0) {
    params.set("excludeUserIds", userScope.excludeUserIds.join(","))
  }
  const res = await fetch(`/v1/admin/app-reports?${params}`, { headers: await getAuthHeaders() })
  if (!res.ok) throw await adminError(res, "Failed to fetch app reports")
  return res.json()
}

export function useAdminAppReports(
  offset: number,
  kind: string,
  appSlug: string,
  status: string,
  userScope: AppReportsUserScope = {},
) {
  const userFilterKey = userScope.userId ?? (userScope.excludeUserIds?.length ? `excl:${userScope.excludeUserIds.length}` : "all")
  return useQuery({
    queryKey: queryKeys.admin.appReports(offset, kind, appSlug, status, userFilterKey),
    queryFn: () => fetchAdminAppReportsPage(offset, 50, kind, appSlug, status, userScope),
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

export function usePatchAppReportMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AppReport["status"] }) => {
      const res = await fetch(`/v1/admin/app-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw await adminError(res, "Failed to update report")
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "app-reports"] }),
  })
}

// --- LLM Models ---

export interface AdminLlmModel {
  readonly id: string
  readonly displayName: string
  readonly tier: "economy" | "standard" | "premium"
  readonly vendor: "anthropic" | "google" | "openai" | "xai"
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
      if (!res.ok) throw await adminError(res, "Failed to fetch LLM models")
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
      if (!res.ok) throw await adminError(res, "Failed to update LLM model")
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

// ──────────────────────────────────────────────────────────────────────────
// Client apps (admin) — the registry of apps built on the Nodaro SDK.
//
// `workflowsListed` drives THE visibility rule for the user's workflow list:
// a workflow shows iff it is native (app_slug IS NULL) or its app is listed.
// Studio is listed (its workflows are first-class); voice-changer-pro is not
// (its rows are private per-conversion storage). Unregistered apps stay hidden —
// the rule fails closed.
// ──────────────────────────────────────────────────────────────────────────

export interface AdminClientApp {
  readonly slug: string
  readonly name: string
  readonly workflowsListed: boolean
  /** null when the count query failed — render "--", not a misleading 0. */
  readonly workflowCount: number | null
  readonly createdAt: string
}

export function useAdminClientApps() {
  return useQuery({
    queryKey: queryKeys.admin.clientApps(),
    queryFn: async (): Promise<AdminClientApp[]> => {
      const res = await fetch("/v1/admin/client-apps", {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw await adminError(res, "Failed to fetch client apps")
      const json = await res.json()
      return (json.data ?? []) as AdminClientApp[]
    },
    enabled: hasAdmin(),
    staleTime: 60_000,
  })
}

export function useToggleClientAppMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ slug, workflowsListed }: { slug: string; workflowsListed: boolean }) => {
      const res = await fetch(`/v1/admin/client-apps/${slug}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify({ workflowsListed }),
      })
      if (!res.ok) throw await adminError(res, "Failed to update client app")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.clientApps() })
      // The core registry query is cached with staleTime: Infinity — this toggle
      // is the only thing that moves it, so it must be evicted here or the
      // workflow list keeps filtering on the old listed set for the session.
      qc.invalidateQueries({ queryKey: queryKeys.clientApps.all })
      qc.invalidateQueries({ queryKey: queryKeys.workflows.all })
    },
  })
}
