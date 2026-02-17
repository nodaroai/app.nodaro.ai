import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAdmin } from "@/hooks/use-admin"

interface AdminJob {
  readonly id: string
  readonly status: string
  readonly credits_used: number | null
  readonly credits_estimated: number | null
  readonly created_at: string
  readonly user_email: string
  readonly workflow_name: string
}

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

export default function AdminJobsPage() {
  const { fetchJobs, loading } = useAdmin()
  const [jobs, setJobs] = useState<ReadonlyArray<AdminJob>>([])
  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>("all")

  useEffect(() => {
    const filter = statusFilter === "all" ? undefined : statusFilter
    fetchJobs(page, 50, filter).then(setJobs)
  }, [fetchJobs, page, statusFilter])

  if (loading && jobs.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Jobs</h1>
        <div className="flex gap-1">
          {STATUS_OPTIONS.map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setPage(0)
                setStatusFilter(s)
              }}
            >
              {s === "all" ? "All" : s}
            </Button>
          ))}
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">ID</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">User</th>
              <th className="text-left px-4 py-2 font-medium">Workflow</th>
              <th className="text-left px-4 py-2 font-medium">Credits</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t">
                <td className="px-4 py-2 font-mono text-xs">{job.id.slice(0, 8)}</td>
                <td className="px-4 py-2">
                  <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                </td>
                <td className="px-4 py-2">{job.user_email}</td>
                <td className="px-4 py-2">{job.workflow_name}</td>
                <td className="px-4 py-2">
                  {job.credits_used ?? job.credits_estimated ?? "-"}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {new Date(job.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No jobs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={jobs.length < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
