import { Fragment, useState } from "react"
import { Loader2, CheckCircle, CheckCheck, XCircle, ChevronRight, ChevronDown, Download, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { hasAdmin } from "@/lib/edition"
import {
  useAdminAppReports,
  usePatchAppReportMutation,
  fetchAdminAppReportsPage,
  type AppReport,
} from "@/ee/hooks/queries/use-admin-queries"
import { downloadMarkdown, exportDateStamp, exportPreamble, fetchAllRows } from "@/ee/lib/admin-export"

/** The generic diagnostic inbox: reports written by platform nodes on behalf
 *  of apps (missing pickers with the image link, provider content rejections,
 *  …). Triage-only — rows are born from lib/app-reports.ts, never from here. */

const LIMIT = 50
const isAdmin = hasAdmin()

const SEVERITY_VARIANT: Record<AppReport["severity"], string> = {
  info: "text-muted-foreground",
  warning: "text-amber-500",
  error: "text-red-500",
}

/** Where the failing work originated: a published app run, a direct-job calling
 *  surface (jobs.source: mcp / web / cli / sdk / api / …), or a workflow run's
 *  trigger. Priority: the resolved app beats the raw surface — an app run's
 *  jobs are orchestrated, so the two never actually compete. */
function reportSource(r: AppReport): { label: string; detail?: string } {
  const appSlug = r.job?.app_slug ?? r.execution?.app_slug ?? r.app_slug
  if (appSlug) return { label: `app: ${appSlug}` }
  if (r.job?.source) return { label: r.job.source, detail: r.job.source_detail ?? undefined }
  const trigger = r.job?.execution_trigger ?? r.execution?.trigger_type
  if (trigger) {
    if (trigger === "mcp") return { label: "mcp", detail: r.job?.mcp_client ?? r.execution?.mcp_client ?? undefined }
    return { label: trigger === "manual" ? "workflow" : `workflow: ${trigger}` }
  }
  return { label: "—" }
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <p className="min-w-0 truncate" title={value}>
      <span className="text-muted-foreground">{label}: </span>
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </p>
  )
}

function reportsMarkdown(rows: AppReport[], total: number, filters: Record<string, string>): string {
  const sections = rows.map((r) => {
    const source = reportSource(r)
    const meta = [
      `source: ${source.label}${source.detail ? ` (${source.detail})` : ""}`,
      `node: ${r.node}`,
      `severity: ${r.severity}`,
      `status: ${r.status}`,
      `created: ${r.created_at}`,
      ...(r.job_id ? [`job: ${r.job_id}`] : []),
      ...(r.user_email || r.user_id ? [`user: ${r.user_email ?? r.user_id}`] : []),
    ].join(" · ")
    return [
      `## [${r.kind}] ${r.title}`,
      "",
      meta,
      ...(r.job?.error_message ? ["", `Job error: ${r.job.error_message}`] : []),
      "",
      "```json",
      JSON.stringify(r.payload, null, 2),
      "```",
    ].join("\n")
  })
  return (
    exportPreamble({
      title: "App reports",
      description:
        "Diagnostic reports from Nodaro apps and platform nodes. Each section is one report; the JSON block is its full payload (image links, observed-vs-chosen picker gaps, provider errors, prompts).",
      filters,
      rowCount: rows.length,
      total,
    }) + sections.join("\n\n")
  )
}

export default function AdminAppReportsPage() {
  const [offset, setOffset] = useState(0)
  const [kind, setKind] = useState("all")
  const [appSlug, setAppSlug] = useState("all")
  const [status, setStatus] = useState("new")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const listQuery = useAdminAppReports(offset, kind, appSlug, status)
  const patch = usePatchAppReportMutation()
  if (!isAdmin) return null

  const reports = listQuery.data?.data ?? []
  const total = listQuery.data?.total ?? 0
  const loading = listQuery.isLoading && reports.length === 0

  const exportMd = async () => {
    setExporting(true)
    try {
      const { rows, total: all } = await fetchAllRows((off, lim) =>
        fetchAdminAppReportsPage(off, lim, kind, appSlug, status),
      )
      downloadMarkdown(
        `app-reports-${exportDateStamp()}.md`,
        reportsMarkdown(rows, all, { kind, app: appSlug, status }),
      )
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">App Reports</h1>
        <p className="text-sm text-muted-foreground">Diagnostics reported by apps and platform nodes</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-44">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Kind</label>
          <Input placeholder="missing-picker, internal-error…" value={kind === "all" ? "" : kind} onChange={(e) => { setKind(e.target.value || "all"); setOffset(0) }} className="text-sm" />
        </div>
        <div className="w-36">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">App</label>
          <Input placeholder="person, studio…" value={appSlug === "all" ? "" : appSlug} onChange={(e) => { setAppSlug(e.target.value || "all"); setOffset(0) }} className="text-sm" />
        </div>
        <div className="w-36">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
          <Select value={status} onValueChange={(v) => { setStatus(v); setOffset(0) }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" disabled={exporting || total === 0} onClick={exportMd}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
          Export .md
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="w-8" />
                <th className="text-left px-3 py-2 font-medium">Created</th>
                <th className="text-left px-3 py-2 font-medium">Source</th>
                <th className="text-left px-3 py-2 font-medium">User</th>
                <th className="text-left px-3 py-2 font-medium">Node</th>
                <th className="text-left px-3 py-2 font-medium">Kind</th>
                <th className="text-left px-3 py-2 font-medium">Title</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const isOpen = expanded === r.id
                const imageUrl = typeof r.payload?.imageUrl === "string" ? r.payload.imageUrl : null
                const source = reportSource(r)
                return (
                  <Fragment key={r.id}>
                    <tr className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setExpanded(isOpen ? null : r.id)}>
                      <td className="pl-2">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs font-mono whitespace-nowrap" title={source.detail}>{source.label}</td>
                      <td className="px-3 py-2 text-xs max-w-[180px] truncate" title={r.user_email ?? r.user_id ?? undefined}>
                        {r.user_email ?? (r.user_id ? `${r.user_id.slice(0, 8)}…` : "—")}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono">{r.node}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className={`text-xs ${SEVERITY_VARIANT[r.severity]}`}>{r.kind}</Badge></td>
                      <td className="px-3 py-2 max-w-[340px] truncate">{r.title}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{r.status}</Badge></td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Reviewed" disabled={patch.isPending} onClick={() => patch.mutate({ id: r.id, status: "reviewed" })}><CheckCircle className="h-3.5 w-3.5 text-blue-400" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Resolved" disabled={patch.isPending} onClick={() => patch.mutate({ id: r.id, status: "resolved" })}><CheckCheck className="h-3.5 w-3.5 text-green-400" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Dismiss" disabled={patch.isPending} onClick={() => patch.mutate({ id: r.id, status: "dismissed" })}><XCircle className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t bg-muted/20">
                        <td />
                        <td colSpan={8} className="px-3 py-3">
                          <div className="mb-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 xl:grid-cols-3">
                            <DetailItem label="User" value={r.user_email ?? "—"} />
                            {r.user_id && <DetailItem label="User ID" value={r.user_id} mono />}
                            <DetailItem label="Source" value={`${source.label}${source.detail ? ` (${source.detail})` : ""}`} />
                            {r.job_id && <DetailItem label="Job" value={r.job_id} mono />}
                            {r.job?.status && <DetailItem label="Job status" value={r.job.status} />}
                            {r.job?.model_identifier && <DetailItem label="Model" value={r.job.model_identifier} mono />}
                            {r.job?.provider && <DetailItem label="Provider" value={r.job.provider} mono />}
                            {(r.job?.workflow_execution_id ?? r.execution_id) && (
                              <DetailItem label="Execution" value={(r.job?.workflow_execution_id ?? r.execution_id) as string} mono />
                            )}
                          </div>
                          {r.job?.error_message && (
                            <p className="mb-2 rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
                              {r.job.error_message}
                            </p>
                          )}
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
                            {imageUrl && (
                              <a href={imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
                                <img src={imageUrl} alt="Reported source" className="max-h-40 rounded border" onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
                                <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><ExternalLink className="h-3 w-3" />open image</span>
                              </a>
                            )}
                            <pre className="min-w-0 flex-1 overflow-x-auto rounded bg-background/60 p-3 text-xs leading-relaxed">
                              {JSON.stringify(r.payload, null, 2)}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {reports.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No reports found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-muted-foreground">Showing {reports.length > 0 ? offset + 1 : 0}–{offset + reports.length} of {total}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}>Previous</Button>
          <Button variant="outline" size="sm" disabled={offset + LIMIT >= total} onClick={() => setOffset((o) => o + LIMIT)}>Next</Button>
        </div>
      </div>
    </div>
  )
}
