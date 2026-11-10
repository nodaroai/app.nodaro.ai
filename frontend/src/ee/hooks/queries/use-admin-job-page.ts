import { useQuery } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { getAuthHeaders } from "@/lib/api"
import { adminError, enrichAdminJobRows, type AdminJob, type JobRow } from "./use-admin-queries"

/**
 * The admin job page (`/admin/job/:id`): one job, whole, read by its id with
 * no list row behind it — so it carries what a row would (the charge, the
 * account's address, the workflow) — and, on request, every job below it.
 */

/** What a whole read of a job carries that a list row never does. */
interface WholeJob extends AdminJob {
  /** The provider's own words about the failure (`jobs.error_detail`, redacted where they were written); null when it said nothing. */
  readonly error_detail: string | null
}

/** One job as its page shows it: a list row's fields, its whole input and output, and where it sits in its run. */
export interface AdminJobPageJob extends WholeJob {
  /** The job this one is a step of; null for a top-level job. */
  readonly parent_job_id: string | null
  /** How many child jobs it has; null when the count could not be read. */
  readonly child_count: number | null
}

/** A job below the page's job, in flow order. */
export interface AdminChildJob extends WholeJob {
  readonly parent_job_id: string | null
  /** Levels below the page's job: 1 for a direct child. */
  readonly depth: number
}

export interface AdminChildJobs {
  readonly jobs: readonly AdminChildJob[]
  /** The run has more jobs than the page lists. */
  readonly truncated: boolean
}

/** The page's answer for a job: the job, or that there is none with that id. */
export type AdminJobPageResult = { readonly kind: "found"; readonly job: AdminJobPageJob } | { readonly kind: "missing" }

type ServerJob = JobRow & {
  parent_job_id?: string | null
  child_count?: number | null
  depth?: number
  error_detail?: string | null
}

export async function fetchAdminJobPage(jobId: string): Promise<AdminJobPageResult> {
  const res = await fetch(`/v1/admin/jobs/${encodeURIComponent(jobId)}`, { headers: await getAuthHeaders() })
  // A malformed id (400) and an unknown one (404) are the same to the page: no such job.
  if (res.status === 404 || res.status === 400) return { kind: "missing" }
  if (!res.ok) throw await adminError(res, "Failed to load the job")
  const { data } = (await res.json()) as { data: ServerJob }
  // The enrichment keeps a list row's fields only: what a whole read adds is put back beside it.
  const [job] = await enrichAdminJobRows([data])
  return {
    kind: "found",
    job: {
      ...job!,
      parent_job_id: data.parent_job_id ?? null,
      child_count: typeof data.child_count === "number" ? data.child_count : null,
      error_detail: data.error_detail ?? null,
    },
  }
}

export async function fetchAdminChildJobs(jobId: string): Promise<AdminChildJobs> {
  const res = await fetch(`/v1/admin/jobs/${encodeURIComponent(jobId)}/children`, { headers: await getAuthHeaders() })
  if (!res.ok) throw await adminError(res, "Failed to load the child jobs")
  const body = (await res.json()) as { data: ServerJob[]; truncated?: boolean }
  const rows = body.data ?? []
  // The flow's order is the server's. The enrichment keeps a list row's fields only, so what a
  // whole read adds is put back beside each step by its id, never by where the enrichment left it.
  const enriched = new Map((await enrichAdminJobRows(rows)).map((job) => [job.id, job] as const))
  return {
    jobs: rows.flatMap((row) => {
      const job = enriched.get(row.id)
      if (!job) return []
      return [{
        ...job,
        parent_job_id: row.parent_job_id ?? null,
        depth: row.depth ?? 1,
        error_detail: row.error_detail ?? null,
      }]
    }),
    truncated: body.truncated === true,
  }
}

/** The page's job, read whole. */
export function useAdminJobPage(jobId: string) {
  return useQuery({
    queryKey: queryKeys.admin.jobPage(jobId),
    queryFn: () => fetchAdminJobPage(jobId),
    enabled: hasAdmin() && jobId.length > 0,
    staleTime: 15_000,
  })
}

/** Every job below the page's job, read only while `enabled` (the page's child-jobs view is on). */
export function useAdminChildJobs(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.jobChildren(jobId),
    queryFn: () => fetchAdminChildJobs(jobId),
    enabled: hasAdmin() && enabled && jobId.length > 0,
    staleTime: 15_000,
  })
}
