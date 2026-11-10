import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { JobAssetView } from "@/components/admin/job-asset-view"
import { JobSourceBadge } from "@/components/admin/job-source-badge"
import type { AdminJob } from "@/ee/hooks/queries/use-admin-queries"
import { JobGenerationDetails, JobSkippedSteps, JobStepOutputs } from "./job-generation-details"
import { creditDetailLines } from "./admin-job-credits"

/**
 * One job's details, shared by the Jobs page's detail dialog and the job page
 * (`/admin/job/:id`): the steps it skipped, a Cast Swap run's preparation
 * steps, the facts grid, the reconciliation box and a failed job's error.
 * Where the input, the output and the error go is each surface's own: tabs in
 * the dialog, one long page there.
 */

/** The address of a job's own page. */
export function adminJobPath(jobId: string): string {
  return `/admin/job/${encodeURIComponent(jobId)}`
}

export function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default"
    case "failed":
    case "cancelled":
      return "destructive"
    case "processing":
    case "queued":
      return "secondary"
    default:
      return "outline"
  }
}

export function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "-"
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return `${ms}ms`
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "-"
  return new Date(dateStr).toLocaleString()
}

export function CopyButton({ text, label = "Copy ID" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

/** A link that opens the job's own page in a new tab. */
export function JobPageLink({ jobId, className, children }: { jobId: string; className?: string; children?: ReactNode }) {
  return (
    <Link
      to={adminJobPath(jobId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open the job page in a new tab"
      title="Open the job page in a new tab"
      className={className ?? "inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"}
    >
      {children ?? <ExternalLink className="h-3.5 w-3.5" />}
    </Link>
  )
}

/** What a whole read of a job's input and output looks like while it loads or when it fails. */
export interface JobDataState {
  readonly data: Record<string, unknown> | null | undefined
  readonly isError: boolean
}

/** A job's input or output, whole: the rendered media and text, then the raw JSON. */
export function JobDataView({ state, size }: { state: JobDataState; size?: "compact" | "large" }) {
  if (state.data !== undefined) return <JobAssetView data={state.data} size={size} />
  if (state.isError) {
    return <p className="py-6 text-center text-sm text-destructive">Couldn&apos;t load the job&apos;s input and output.</p>
  }
  return (
    <div className="flex justify-center py-6" aria-label="Loading the job's input and output">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  )
}

/**
 * A failed job's error: the sentence the platform showed for it, and under it
 * the provider's own words about the failure when the job kept any (redacted
 * where they were written). The words come with a whole read of the job: a
 * list row never carries them, so `detail` is undefined until that read is in.
 * A read that failed says so (`detailUnread`): showing no words must never
 * read as the provider having said nothing.
 */
export function JobErrorView({
  message,
  detail,
  detailUnread = false,
  size = "compact",
}: {
  message: string | null
  /** The provider's own words: null when it said nothing, undefined while the whole job loads. */
  detail: string | null | undefined
  /** The whole read failed and left no words to show. */
  detailUnread?: boolean
  size?: "compact" | "large"
}) {
  const height = size === "large" ? "max-h-[60vh]" : "max-h-64"
  return (
    <div className="flex flex-col gap-3">
      {message && (
        <pre className={`text-xs bg-red-950/30 text-red-400 rounded-lg p-4 overflow-auto ${height} whitespace-pre-wrap`}>
          {message}
        </pre>
      )}
      {detail ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Provider&apos;s words</p>
          <pre className={`text-xs bg-muted/40 text-foreground rounded-lg p-4 overflow-auto ${height} whitespace-pre-wrap`}>
            {detail}
          </pre>
        </div>
      ) : detailUnread ? (
        <p className="text-sm text-destructive">Couldn&apos;t load the provider&apos;s words.</p>
      ) : null}
    </div>
  )
}

/**
 * The job's facts. `full` is the whole input and output when it is in (the
 * generation details and skipped steps read it); undefined while it loads.
 */
export function JobInfoSections({
  job,
  full,
}: {
  job: AdminJob
  full: { input_data: Record<string, unknown> | null; output_data: Record<string, unknown> | null } | undefined
}) {
  const hasReconcileData =
    job.provider_kind != null ||
    job.provider_task_id != null ||
    job.reconcile_attempts > 0 ||
    job.reconcile_last_error != null
  return (
    <>
      {full && <JobSkippedSteps output={full.output_data} />}
      <JobStepOutputs job={job} />

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm border rounded-lg p-4">
        <div>
          <span className="text-muted-foreground">Provider</span>
          <p>{job.provider ?? "-"}</p>
        </div>
        {full && <JobGenerationDetails input={full.input_data} />}
        <div>
          <span className="text-muted-foreground">Cost</span>
          <p>{job.display_cost != null ? `$${job.display_cost.toFixed(4)}` : "-"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Provider Cost</span>
          <p>{job.provider_cost != null ? `$${job.provider_cost.toFixed(4)}` : "-"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Credits</span>
          {/* The settled charge beside the hold (jobs.credits is the hold), and a parent's run with its steps. */}
          {creditDetailLines(job).length > 0
            ? creditDetailLines(job).map((line) => <p key={line}>{line}</p>)
            : <p>-</p>}
        </div>
        <div>
          <span className="text-muted-foreground">Created</span>
          <p>{formatDateTime(job.created_at)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Started</span>
          <p>{formatDateTime(job.started_at)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Completed</span>
          <p>{formatDateTime(job.completed_at)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Processing time</span>
          <p>{formatDuration(job.started_at, job.completed_at)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">User</span>
          <p className="break-all">{job.user_email}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Workflow</span>
          <p>
            {job.workflow_id ? (
              <Link
                to={job.workflow_project_id ? `/projects/${job.workflow_project_id}/workflows/${job.workflow_id}` : `/projects`}
                target="_blank"
                className="text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                {job.workflow_name} <ExternalLink className="h-3 w-3" />
              </Link>
            ) : "-"}
          </p>
        </div>
        <div className="col-span-2">
          <span className="text-muted-foreground">Source</span>
          <p>
            <JobSourceBadge source={job.source} sourceDetail={job.source_detail} appName={job.source_app_name} />
            {job.workflow_execution_id && (
              <span className="ml-2">Workflow Execution <span className="font-mono text-xs text-muted-foreground">({job.workflow_execution_id.slice(0, 8)})</span></span>
            )}
          </p>
        </div>
      </div>

      {hasReconcileData && (
        <div className="border rounded-lg p-4">
          <div className="text-sm font-medium mb-2">Reconciliation</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Provider Kind</span>
              <p className="font-mono text-xs">{job.provider_kind ?? "-"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Provider Task ID</span>
              <p className="font-mono text-xs break-all">{job.provider_task_id ?? "-"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Reconcile Attempts</span>
              <p>
                {job.reconcile_attempts === 0 ? (
                  <span className="text-muted-foreground">0</span>
                ) : job.reconcile_last_error === "exhausted" ? (
                  <Badge variant="destructive" className="text-xs">{job.reconcile_attempts} — exhausted</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">{job.reconcile_attempts}</Badge>
                )}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Provider Call Started</span>
              <p>{formatDateTime(job.provider_call_started_at)}</p>
            </div>
            {job.reconcile_last_error && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Last Error</span>
                <p className="font-mono text-xs whitespace-pre-wrap break-words">{job.reconcile_last_error}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
