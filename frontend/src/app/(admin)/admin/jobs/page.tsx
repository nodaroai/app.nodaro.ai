import { useState } from "react"
import { Link } from "react-router-dom"
import { Loader2, Info, Copy, Check, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { UserFilter } from "@/components/user-filter"
import { useAdminJobs, useAllAdminUsersLite, type AdminJob } from "@/hooks/queries/use-admin-queries"

const STATUS_OPTIONS = ["all", "pending", "queued", "processing", "completed", "failed", "cancelled"] as const

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
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

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "-"
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return `${ms}ms`
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "-"
  return new Date(dateStr).toLocaleString()
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
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

function JobDetailDialog({ job, open, onOpenChange }: { job: AdminJob; open: boolean; onOpenChange: (v: boolean) => void }) {
  const hasError = !!job.error_message
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="font-mono text-sm">{job.id}</span>
            <CopyButton text={job.id} />
            <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
          </DialogTitle>
          {job.job_type && (
            <p className="text-sm text-muted-foreground">{job.job_type}</p>
          )}
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm border rounded-lg p-4">
          <div>
            <span className="text-muted-foreground">Provider</span>
            <p>{job.provider ?? "-"}</p>
          </div>
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
            <p>{job.credits ?? "-"}</p>
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
            <span className="text-muted-foreground">Duration</span>
            <p>{formatDuration(job.started_at, job.completed_at)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">User</span>
            <p>{job.user_email}</p>
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
              {job.workflow_execution_id ? (
                <span>Workflow Execution <span className="font-mono text-xs text-muted-foreground">({job.workflow_execution_id.slice(0, 8)})</span></span>
              ) : "Single Node Run"}
            </p>
          </div>
        </div>

        <Tabs defaultValue="input">
          <TabsList>
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            {hasError && <TabsTrigger value="error">Error</TabsTrigger>}
          </TabsList>
          <TabsContent value="input">
            <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-auto max-h-64 whitespace-pre-wrap">
              {job.input_data ? JSON.stringify(job.input_data, null, 2) : "No input data"}
            </pre>
          </TabsContent>
          <TabsContent value="output">
            <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-auto max-h-64 whitespace-pre-wrap">
              {job.output_data ? JSON.stringify(job.output_data, null, 2) : "No output data"}
            </pre>
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

export default function AdminJobsPage() {
  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const { data: users = [] } = useAllAdminUsersLite()
  const [selectedJob, setSelectedJob] = useState<AdminJob | null>(null)
  const filter = statusFilter === "all" ? undefined : statusFilter
  const { data: jobs = [], isLoading: loading } = useAdminJobs(page, 50, filter, selectedUserId ?? undefined)

  if (loading && jobs.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4">
        <h1 className="text-xl font-bold">Jobs</h1>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {users.length > 0 && (
            <UserFilter
              users={users}
              value={selectedUserId}
              onChange={(id) => { setPage(0); setSelectedUserId(id) }}
            />
          )}
          <div className="flex gap-1">
            {STATUS_OPTIONS.map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => { setPage(0); setStatusFilter(s) }}
              >
                {s === "all" ? "All" : s}
              </Button>
            ))}
          </div>
        </div>
      </div>

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
              <th className="text-left px-3 py-2 font-medium">Error</th>
              <th className="text-left px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium w-10" />
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
                <td className="px-3 py-2 text-xs text-muted-foreground">{job.job_type ?? "-"}</td>
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
                  {job.workflow_execution_id
                    ? <Badge variant="outline" className="text-xs">Workflow</Badge>
                    : <span className="text-xs text-muted-foreground">Single</span>
                  }
                </td>
                <td className="px-3 py-2 text-xs">{job.credits ?? "-"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{job.provider ?? "-"}</td>
                <td className="px-3 py-2 text-xs">{job.display_cost != null ? `$${job.display_cost.toFixed(4)}` : "-"}</td>
                <td className="px-3 py-2 text-xs max-w-[100px] truncate text-red-400" title={job.error_message ?? undefined}>
                  {job.error_message ? job.error_message.slice(0, 40) : "-"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(job.created_at)}</td>
                <td className="px-3 py-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedJob(job)}>
                    <Info className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">
                  No jobs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-4">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={jobs.length < 50} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>

      {selectedJob && (
        <JobDetailDialog job={selectedJob} open={!!selectedJob} onOpenChange={(v) => { if (!v) setSelectedJob(null) }} />
      )}
    </div>
  )
}
