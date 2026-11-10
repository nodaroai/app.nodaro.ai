import { Link, useParams, useSearchParams } from "react-router-dom"
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  useAdminChildJobs,
  useAdminJobPage,
  type AdminChildJob,
  type AdminJobPageJob,
} from "@/ee/hooks/queries/use-admin-job-page"
import { rowJobType } from "../jobs/job-kinds"
import { creditCell } from "../jobs/admin-job-credits"
import {
  adminJobPath,
  CopyButton,
  formatDateTime,
  formatDuration,
  JobDataView,
  JobErrorView,
  JobInfoSections,
  JobPageLink,
  statusVariant,
} from "../jobs/job-detail-view"

/**
 * One job on a page of its own (`/admin/job/:id`): everything the Jobs page's
 * detail dialog shows, with the input and the output rendered in full one
 * under the other instead of in tabs, and a direct link an admin can share.
 *
 * `?children=1` adds the job's child jobs — the steps a run like Cast Swap
 * ran for it — as a flow: a numbered overview, then each step whole, in the
 * order the run did its work (each job followed by its own children).
 */

/** The search parameter that turns the child-jobs flow on. */
export const CHILDREN_PARAM = "children"

export default function AdminJobPage() {
  const { id = "" } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const showChildren = searchParams.get(CHILDREN_PARAM) === "1"
  const page = useAdminJobPage(id)

  const setShowChildren = (on: boolean) => {
    const next = new URLSearchParams(searchParams)
    if (on) next.set(CHILDREN_PARAM, "1")
    else next.delete(CHILDREN_PARAM)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="p-6 max-w-5xl mx-auto flex flex-col gap-6">
      <Link to="/admin/jobs" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Jobs
      </Link>

      {page.isError ? (
        <p className="py-16 text-center text-sm text-destructive">Couldn&apos;t load the job. Try again.</p>
      ) : !page.data ? (
        <div className="flex justify-center py-16" aria-label="Loading the job">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : page.data.kind === "missing" ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No job with the id <span className="font-mono">{id}</span>.</p>
      ) : (
        <>
          <header className="flex flex-col gap-2">
            <h1 className="flex flex-wrap items-center gap-3 text-lg font-bold">
              <span className="min-w-0 break-all font-mono text-base">{page.data.job.id}</span>
              <CopyButton text={page.data.job.id} />
              <Badge variant={statusVariant(page.data.job.status)}>{page.data.job.status}</Badge>
            </h1>
            {rowJobType(page.data.job) && <p className="text-sm text-muted-foreground">{rowJobType(page.data.job)}</p>}
            {page.data.job.parent_job_id && (
              <p className="text-sm text-muted-foreground">
                A step of{" "}
                <Link to={adminJobPath(page.data.job.parent_job_id)} className="font-mono text-blue-400 hover:underline">
                  {page.data.job.parent_job_id.slice(0, 8)}
                </Link>
              </p>
            )}
          </header>

          <JobBody job={page.data.job} />

          <ChildJobsSection
            jobId={page.data.job.id}
            count={page.data.job.child_count}
            shown={showChildren}
            onShownChange={setShowChildren}
          />
        </>
      )}
    </div>
  )
}

/**
 * A job's facts, then its error, its input and its output, each in full. The
 * error is the sentence the platform showed and the provider's own words about
 * the failure; a job that kept either one has the section.
 */
function JobBody({ job }: { job: AdminJobPageJob | AdminChildJob }) {
  const full = { input_data: job.input_data, output_data: job.output_data }
  return (
    <div className="flex flex-col gap-6">
      <JobInfoSections job={job} full={full} />
      {(job.error_message || job.error_detail) && (
        <section className="flex flex-col gap-2" aria-label="Error">
          <h2 className="text-sm font-semibold">Error</h2>
          <JobErrorView message={job.error_message} detail={job.error_detail} size="large" />
        </section>
      )}
      <section className="flex flex-col gap-2" aria-label="Input">
        <h2 className="text-sm font-semibold">Input</h2>
        <JobDataView state={{ data: job.input_data, isError: false }} size="large" />
      </section>
      <section className="flex flex-col gap-2" aria-label="Output">
        <h2 className="text-sm font-semibold">Output</h2>
        <JobDataView state={{ data: job.output_data, isError: false }} size="large" />
      </section>
    </div>
  )
}

function ChildJobsSection({
  jobId,
  count,
  shown,
  onShownChange,
}: {
  jobId: string
  /** How many child jobs the job has; null when unknown. */
  count: number | null
  shown: boolean
  onShownChange: (on: boolean) => void
}) {
  const children = useAdminChildJobs(jobId, shown)
  // A job with no child jobs shows nothing here, unless a link asked for them.
  if (count === 0 && !shown) return null
  return (
    <section className="flex flex-col gap-4 border-t pt-6" aria-label="Child jobs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          Child jobs{count != null ? ` (${count} direct)` : ""}
        </h2>
        <Button variant="outline" size="sm" onClick={() => onShownChange(!shown)}>
          {shown ? "Hide child jobs" : "Show child jobs"}
        </Button>
      </div>
      {shown && (
        children.isError ? (
          <p className="text-sm text-destructive">Couldn&apos;t load the child jobs. Try again.</p>
        ) : !children.data ? (
          <div className="flex justify-center py-6" aria-label="Loading the child jobs">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : children.data.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">This job has no child jobs.</p>
        ) : (
          <ChildJobsFlow jobs={children.data.jobs} truncated={children.data.truncated} />
        )
      )}
    </section>
  )
}

const anchorOf = (jobId: string) => `job-${jobId}`

/** The flow: a numbered overview of the steps, then each step whole. */
function ChildJobsFlow({ jobs, truncated }: { jobs: readonly AdminChildJob[]; truncated: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col gap-1 rounded-lg border p-3 text-sm" aria-label="Flow">
        {jobs.map((job, i) => (
          <li key={job.id} className="flex flex-wrap items-center gap-2" style={{ paddingInlineStart: `${(job.depth - 1) * 1.25}rem` }}>
            <span className="w-6 shrink-0 text-end font-mono text-xs text-muted-foreground">{i + 1}.</span>
            <a href={`#${anchorOf(job.id)}`} className="hover:underline">{rowJobType(job) ?? job.job_type ?? "job"}</a>
            <Badge variant={statusVariant(job.status)} className="text-xs">{job.status}</Badge>
            <span className="text-xs text-muted-foreground">{formatDuration(job.started_at, job.completed_at)}</span>
            <span className="text-xs text-muted-foreground">{creditCell(job).main}</span>
          </li>
        ))}
      </ol>
      {truncated && (
        <p className="text-sm text-muted-foreground">This run has more child jobs than the page lists; the first ones are shown.</p>
      )}
      {jobs.map((job, i) => (
        <ChildJobCard key={job.id} job={job} step={i + 1} />
      ))}
    </div>
  )
}

function ChildJobCard({ job, step }: { job: AdminChildJob; step: number }) {
  return (
    <details
      id={anchorOf(job.id)}
      open
      className="scroll-mt-4 rounded-lg border"
      style={{ marginInlineStart: `${(job.depth - 1) * 1.25}rem` }}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 select-none">
        <span className="font-mono text-xs text-muted-foreground">{step}.</span>
        <span className="font-medium">{rowJobType(job) ?? job.job_type ?? "job"}</span>
        <Badge variant={statusVariant(job.status)} className="text-xs">{job.status}</Badge>
        <span className="text-xs text-muted-foreground">{job.provider ?? ""}</span>
        <span className="text-xs text-muted-foreground">{formatDateTime(job.created_at)}</span>
        <span className="ms-auto flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{job.id.slice(0, 8)}</span>
          <CopyButton text={job.id} />
          <JobPageLink jobId={job.id}>
            <ExternalLink className="h-3.5 w-3.5" />
          </JobPageLink>
        </span>
      </summary>
      <div className="border-t p-4">
        <JobBody job={job} />
      </div>
    </details>
  )
}
