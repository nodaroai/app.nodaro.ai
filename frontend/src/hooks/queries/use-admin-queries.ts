import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
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

interface AdminJob {
  readonly id: string
  readonly status: string
  readonly credits_used: number | null
  readonly credits_estimated: number | null
  readonly created_at: string
  readonly user_email: string
  readonly workflow_name: string
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
      const [usersRes, projectsRes, workflowsRes, jobsCountRes, jobsStatusRes, usageRes] =
        await Promise.all([
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("projects").select("id", { count: "exact", head: true }),
          supabase.from("workflows").select("id", { count: "exact", head: true }),
          supabase.from("jobs").select("id", { count: "exact", head: true }),
          supabase.from("jobs").select("status"),
          supabase.from("usage_logs").select("credits_used"),
        ])
      const jobsByStatus: Record<string, number> = {}
      for (const job of jobsStatusRes.data ?? []) {
        jobsByStatus[job.status] = (jobsByStatus[job.status] ?? 0) + 1
      }
      const totalCreditsUsed = (usageRes.data ?? []).reduce(
        (sum: number, log: { credits_used?: number }) => sum + (log.credits_used ?? 0),
        0,
      )
      return {
        totalUsers: usersRes.count ?? 0,
        totalProjects: projectsRes.count ?? 0,
        totalWorkflows: workflowsRes.count ?? 0,
        totalJobs: jobsCountRes.count ?? 0,
        jobsByStatus,
        totalCreditsUsed,
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

export function useAdminJobs(page: number, pageSize = 50, statusFilter?: string) {
  return useQuery({
    queryKey: queryKeys.admin.jobs(page, pageSize, statusFilter),
    queryFn: async (): Promise<AdminJob[]> => {
      const supabase = createClient()
      let query = supabase
        .from("jobs")
        .select("id, status, credits_used, credits_estimated, created_at, user_id, workflow_id")
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (statusFilter) query = query.eq("status", statusFilter)
      const { data: jobs, error } = await query
      if (error) throw error
      if (!jobs || jobs.length === 0) return []
      const userIds = [...new Set(jobs.map((j) => j.user_id))]
      const workflowIds = [...new Set(jobs.map((j) => j.workflow_id).filter(Boolean) as string[])]
      const [usersRes, workflowsRes] = await Promise.all([
        supabase.from("profiles").select("id, email").in("id", userIds),
        supabase.from("workflows").select("id, name").in("id", workflowIds),
      ])
      const userMap = new Map((usersRes.data ?? []).map((u) => [u.id, u.email]))
      const wfMap = new Map((workflowsRes.data ?? []).map((w) => [w.id, w.name]))
      return jobs.map((j) => ({
        id: j.id,
        status: j.status,
        credits_used: j.credits_used,
        credits_estimated: j.credits_estimated,
        created_at: j.created_at,
        user_email: userMap.get(j.user_id) ?? "Unknown",
        workflow_name: wfMap.get(j.workflow_id ?? "") ?? "Unknown",
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
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/models`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
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
        headers: { Authorization: `Bearer ${session?.access_token}` },
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
      const res = await fetch(`/v1/admin/alerts`)
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
      const res = await fetch(`/v1/admin/settings`)
      if (!res.ok) throw new Error("Failed to fetch settings")
      const data = await res.json()
      const settings = data.settings as Record<string, unknown>
      return {
        ai_provider: (settings.ai_provider as "replicate" | "kie") ?? "replicate",
        cost_markup_percent: (settings.cost_markup_percent as number) ?? 25,
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
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/users/${userId}/transactions?limit=20`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
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
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/models/${modelId}/pricing`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
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
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/users/${params.userId}/credits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
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
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/gallery-reports/${reportId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
      const res = await fetch(`/v1/admin/alerts/${id}`, { method: "DELETE" })
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
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/users/${userId}/tier`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
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
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/users/${userId}/storage`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
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
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/users/${userId}/role`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
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
