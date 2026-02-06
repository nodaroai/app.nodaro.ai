"use client"

import { useCallback, useState } from "react"
import { createClient } from "@/lib/supabase"

interface AdminStats {
  readonly totalUsers: number
  readonly totalProjects: number
  readonly totalWorkflows: number
  readonly totalJobs: number
  readonly jobsByStatus: Record<string, number>
  readonly totalCreditsUsed: number
}

interface AdminUser {
  readonly id: string
  readonly email: string
  readonly full_name: string | null
  readonly tier: string
  readonly credits_balance: number
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

export interface AppSettings {
  readonly ai_provider: "replicate" | "kie"
  readonly cost_markup_percent: number
}

export function useAdmin() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async (): Promise<AdminStats | null> => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()

      const [usersRes, projectsRes, workflowsRes, jobsRes, usageRes] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("projects").select("id", { count: "exact", head: true }),
        supabase.from("workflows").select("id", { count: "exact", head: true }),
        supabase.from("jobs").select("id, status"),
        supabase.from("usage_logs").select("credits_used"),
      ])

      const jobsByStatus: Record<string, number> = {}
      for (const job of jobsRes.data ?? []) {
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
        totalJobs: jobsRes.data?.length ?? 0,
        jobsByStatus,
        totalCreditsUsed,
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch stats")
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchUsers = useCallback(async (page = 0, pageSize = 50): Promise<ReadonlyArray<AdminUser>> => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: err } = await supabase
        .from("profiles")
        .select("id, email, full_name, tier, credits_balance, role, created_at")
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (err) {
        setError(err.message)
        return []
      }
      return data ?? []
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch users")
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchJobs = useCallback(async (page = 0, pageSize = 50, statusFilter?: string): Promise<ReadonlyArray<AdminJob>> => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      let query = supabase
        .from("jobs")
        .select("id, status, credits_used, credits_estimated, created_at, user_id, workflow_id")
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (statusFilter) {
        query = query.eq("status", statusFilter)
      }

      const { data: jobs, error: err } = await query

      if (err) {
        setError(err.message)
        return []
      }

      if (!jobs || jobs.length === 0) return []

      const userIds = [...new Set(jobs.map((j: Record<string, string>) => j.user_id))]
      const workflowIds = [...new Set(jobs.map((j: Record<string, string>) => j.workflow_id))]

      const [usersRes, workflowsRes] = await Promise.all([
        supabase.from("profiles").select("id, email").in("id", userIds),
        supabase.from("workflows").select("id, name").in("id", workflowIds),
      ])

      const userMap = new Map((usersRes.data ?? []).map((u: Record<string, string>) => [u.id, u.email]))
      const wfMap = new Map((workflowsRes.data ?? []).map((w: Record<string, string>) => [w.id, w.name]))

      return jobs.map((j: Record<string, unknown>) => ({
        id: j.id,
        status: j.status,
        credits_used: j.credits_used,
        credits_estimated: j.credits_estimated,
        created_at: j.created_at,
        user_email: userMap.get(j.user_id) ?? "Unknown",
        workflow_name: wfMap.get(j.workflow_id) ?? "Unknown",
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch jobs")
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchUsageLogs = useCallback(async (page = 0, pageSize = 50): Promise<ReadonlyArray<AdminUsageLog>> => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: logs, error: err } = await supabase
        .from("usage_logs")
        .select("id, action, provider, credits_used, created_at, user_id")
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (err) {
        setError(err.message)
        return []
      }

      if (!logs || logs.length === 0) return []

      const userIds = [...new Set(logs.map((l: Record<string, string>) => l.user_id))]
      const { data: users } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", userIds)

      const userMap = new Map((users ?? []).map((u: Record<string, string>) => [u.id, u.email]))

      return logs.map((l: Record<string, unknown>) => ({
        id: l.id,
        action: l.action,
        provider: l.provider,
        credits_used: l.credits_used,
        created_at: l.created_at,
        user_email: userMap.get(l.user_id) ?? "Unknown",
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch usage logs")
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSettings = useCallback(async (): Promise<AppSettings | null> => {
    setLoading(true)
    setError(null)
    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const response = await fetch(`${API_BASE_URL}/v1/admin/settings`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error?.message || `Request failed with status ${response.status}`)
      }
      const data = await response.json()
      const settings = data.settings as Record<string, unknown>
      return {
        ai_provider: (settings.ai_provider as "replicate" | "kie") ?? "replicate",
        cost_markup_percent: (settings.cost_markup_percent as number) ?? 25,
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch settings")
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const updateSetting = useCallback(async (key: string, value: unknown): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const response = await fetch(`${API_BASE_URL}/v1/admin/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error?.message || `Request failed with status ${response.status}`)
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update setting")
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, error, fetchStats, fetchUsers, fetchJobs, fetchUsageLogs, fetchSettings, updateSetting }
}
