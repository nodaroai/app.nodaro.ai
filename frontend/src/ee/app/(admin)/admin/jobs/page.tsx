import { useCallback, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Loader2, Info, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { UserFilter, type UserFilterValue } from "@/components/user-filter"
import { JobSourceBadge } from "@/components/admin/job-source-badge"
import {
  useAdminJobDetail,
  useAdminJobs,
  useAdminJobSources,
  useAllAdminUsersLite,
  type AdminJob,
  type AdminJobDetail,
} from "@/ee/hooks/queries/use-admin-queries"
import { JobsGallery } from "./jobs-gallery"
import { FiltersUnavailableNotice, JobsFilterBar } from "./jobs-filter-bar"
import { ADMIN_JOB_STATUSES, jobFiltersKey, parseJobFilters, serializeJobFilters, type AdminJobFilters } from "./jobs-filters"
import { rowJobType } from "./job-kinds"
import { creditCell } from "./admin-job-credits"
import { CopyButton, JobDataView, JobInfoSections, JobPageLink, statusVariant } from "./job-detail-view"

const STATUS_OPTIONS = ["all", ...ADMIN_JOB_STATUSES] as const

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** The charge as the figure, the hold (and a parent's run total) as secondary text; the full sentence on hover. */
function CreditCell({ job }: { job: AdminJob }) {
  const { main, secondary, title } = creditCell(job)
  return (
    <span className="flex flex-col whitespace-nowrap" title={title}>
      <span>{main}</span>
      {secondary.map((line) => (
        <span key={line} className="text-[11px] text-muted-foreground">{line}</span>
      ))}
    </span>
  )
}

function JobDetailDialog({
  job,
  open,
  onOpenChange,
  tab,
  onTabChange,
}: {
  job: AdminJob
  open: boolean
  onOpenChange: (v: boolean) => void
  tab: string
  onTabChange: (v: string) => void
}) {
  const hasError = !!job.error_message
  // A list row carries previews of the input and output; the whole of both is
  // read when the dialog opens, and only the whole is ever shown here.
  const detail = useAdminJobDetail(open ? job : null)
  const full = detail.data
  const dataState = (pick: (d: AdminJobDetail) => Record<string, unknown> | null) => ({
    data: full ? pick(full) : undefined,
    isError: detail.isError,
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 break-all font-mono text-sm">{job.id}</span>
            <CopyButton text={job.id} />
            <JobPageLink jobId={job.id} />
            <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
          </DialogTitle>
          {rowJobType(job) && (
            <p className="text-sm text-muted-foreground">{rowJobType(job)}</p>
          )}
        </DialogHeader>

        <JobInfoSections job={job} full={full} />

        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList>
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            {hasError && <TabsTrigger value="error">Error</TabsTrigger>}
          </TabsList>
          <TabsContent value="input">
            <JobDataView state={dataState((d) => d.input_data)} />
          </TabsContent>
          <TabsContent value="output">
            <JobDataView state={dataState((d) => d.output_data)} />
          </TabsContent>
          {hasError && (
            <TabsContent value="error">
              <pre className="text-xs bg-red-950/30 text-red-400 rounded-lg p-4 overflow-auto max-h-64 whitespace-pre-wrap">
                {job.error_message}
              </pre>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

const PAGE_SIZE = 50

/** The user filter's value for the filters' user (an address, or "admins hidden"). */
function userFilterValue(filters: AdminJobFilters, users: ReadonlyArray<{ id: string; email: string }>): UserFilterValue {
  if (filters.userEmail) {
    const email = filters.userEmail
    const user = users.find((u) => u.email.toLowerCase() === email)
    // An address no loaded account has still filters (the server answers); the trigger reads "unknown user".
    return { kind: "user", id: user?.id ?? "" }
  }
  return filters.excludeAdmins ? { kind: "exclude_admins" } : { kind: "all" }
}

export default function AdminJobsPage() {
  // Every filter, the view included, lives in the URL: a refresh, a bookmark
  // or a shared link reopens the same filtered view.
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseJobFilters(searchParams), [searchParams])
  // A pick is a history step (Back undoes it); a search being typed replaces the current entry.
  const setFilters = useCallback(
    (next: AdminJobFilters, how?: { replace: true }) =>
      setSearchParams(serializeJobFilters(next), { replace: how?.replace === true }),
    [setSearchParams],
  )
  const filtersKey = jobFiltersKey(filters)
  // The table's page belongs to one set of filters: any change, back/forward included, starts at page 0.
  const [pageAt, setPageAt] = useState({ key: filtersKey, page: 0 })
  const page = pageAt.key === filtersKey ? pageAt.page : 0
  const setPage = (next: number) => setPageAt({ key: filtersKey, page: next })

  const { data: users = [], isSuccess: usersLoaded, isError: usersFailed } = useAllAdminUsersLite()
  const { data: sources = [] } = useAdminJobSources()

  const adminIds = useMemo(
    () => users.filter((u) => u.role !== "user").map((u) => u.id),
    [users],
  )

  const onUserFilter = (next: UserFilterValue) => {
    if (next.kind === "user") {
      const email = users.find((u) => u.id === next.id)?.email
      if (email) setFilters({ ...filters, userEmail: email.toLowerCase(), excludeAdmins: false })
    } else {
      setFilters({ ...filters, userEmail: undefined, excludeAdmins: next.kind === "exclude_admins" })
    }
  }
  const statusFilter = filters.status ?? "all"
  const view = filters.view

  const [selectedJob, setSelectedJob] = useState<AdminJob | null>(null)
  // The detail dialog's active tab (controlled so a gallery tile can open
  // straight to Output; the table opens Input as before).
  const [detailTab, setDetailTab] = useState<string>("input")
  // Hiding the admins needs their ids: hold the request until the list is in,
  // so a refreshed or shared link never flashes the admins' jobs first.
  const hidesAdmins = filters.excludeAdmins && !filters.userEmail
  const jobsReady = !hidesAdmins || usersLoaded
  const { data, isLoading, isError } = useAdminJobs(page, PAGE_SIZE, filters, adminIds, { enabled: jobsReady })
  const loading = isLoading || !jobsReady
  const jobs = data?.jobs ?? []

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Jobs</h1>
          <div className="flex gap-1 rounded-lg border bg-background p-1">
            <button
              type="button"
              onClick={() => setFilters({ ...filters, view: "table" })}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${view === "table" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setFilters({ ...filters, view: "gallery" })}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${view === "gallery" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Gallery
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {users.length > 0 && (
            <UserFilter
              users={users}
              value={userFilterValue(filters, users)}
              onChange={onUserFilter}
            />
          )}
          <div className="flex gap-1">
            {STATUS_OPTIONS.map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setFilters({ ...filters, status: s === "all" ? undefined : s })}
              >
                {s === "all" ? "All" : s}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <JobsFilterBar filters={filters} onChange={setFilters} sources={sources} />

      {hidesAdmins && usersFailed && (
        <p className="mb-3 text-sm text-destructive">Couldn&apos;t load the admin accounts to hide. Reload to try again.</p>
      )}

      {view === "table" ? (
        isError && jobs.length === 0 ? (
        <div className="py-16 text-center font-mono text-sm text-destructive">
          Couldn&apos;t load jobs. Try again.
        </div>
      ) : loading && jobs.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
      <>
      {data?.filtersUnavailable && <FiltersUnavailableNotice />}
      {data?.userNotFound && (
        <p className="mb-3 text-sm text-destructive">No user with that email</p>
      )}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium">ID</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-left px-3 py-2 font-medium">User</th>
              <th className="text-left px-3 py-2 font-medium">Workflow</th>
              <th className="text-left px-3 py-2 font-medium">Source</th>
              <th className="text-left px-3 py-2 font-medium">Credits</th>
              <th className="text-left px-3 py-2 font-medium">Provider</th>
              <th className="text-left px-3 py-2 font-medium">Cost</th>
              <th className="text-left px-3 py-2 font-medium" title="Reconciliation attempts (Phase 1-5)">Recon</th>
              <th className="text-left px-3 py-2 font-medium">Error</th>
              <th className="text-left px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium w-20" />
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2">
                  <button
                    className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy ID"
                    onClick={() => navigator.clipboard.writeText(job.id)}
                  >
                    {job.id.slice(0, 8)}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={statusVariant(job.status)} className="text-xs">{job.status}</Badge>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{rowJobType(job) ?? "-"}</td>
                <td className="px-3 py-2 text-xs max-w-[140px] truncate" title={job.user_email}>{job.user_email}</td>
                <td className="px-3 py-2 text-xs max-w-[120px] truncate">
                  {job.workflow_id ? (
                    <Link
                      to={job.workflow_project_id ? `/projects/${job.workflow_project_id}/workflows/${job.workflow_id}` : `/projects`}
                      target="_blank"
                      className="text-blue-400 hover:underline"
                      title={job.workflow_name}
                    >
                      {job.workflow_name}
                    </Link>
                  ) : <span className="text-muted-foreground">-</span>}
                </td>
                <td className="px-3 py-2">
                  <JobSourceBadge
                    source={job.source}
                    sourceDetail={job.source_detail}
                    appName={job.source_app_name}
                    workflowExecutionId={job.workflow_execution_id}
                  />
                </td>
                <td className="px-3 py-2 text-xs">
                  <CreditCell job={job} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{job.provider ?? "-"}</td>
                <td className="px-3 py-2 text-xs">{job.display_cost != null ? `$${job.display_cost.toFixed(4)}` : "-"}</td>
                <td className="px-3 py-2 text-xs" title={job.reconcile_last_error ?? job.provider_kind ?? undefined}>
                  {job.reconcile_attempts > 0 ? (
                    job.reconcile_last_error === "exhausted" ? (
                      <Badge variant="destructive" className="text-xs">{job.reconcile_attempts}!</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">{job.reconcile_attempts}</Badge>
                    )
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs max-w-[100px] truncate text-red-400" title={job.error_message ?? undefined}>
                  {job.error_message ? job.error_message.slice(0, 40) : "-"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(job.created_at)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Job details"
                      title="Job details"
                      onClick={() => setSelectedJob(job)}
                    >
                      <Info className="h-4 w-4" />
                    </Button>
                    <JobPageLink
                      jobId={job.id}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </JobPageLink>
                  </div>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-muted-foreground">
                  No jobs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-4">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={jobs.length < PAGE_SIZE} onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </div>
      </>
      )
      ) : (
        <JobsGallery
          filters={filters}
          excludeUserIds={adminIds}
          enabled={jobsReady}
          onOpenJob={(job) => {
            setSelectedJob(job)
            setDetailTab("output")
          }}
        />
      )}

      {selectedJob && (
        <JobDetailDialog
          job={selectedJob}
          open={!!selectedJob}
          onOpenChange={(v) => {
            if (!v) {
              setSelectedJob(null)
              setDetailTab("input")
            }
          }}
          tab={detailTab}
          onTabChange={setDetailTab}
        />
      )}
    </div>
  )
}
