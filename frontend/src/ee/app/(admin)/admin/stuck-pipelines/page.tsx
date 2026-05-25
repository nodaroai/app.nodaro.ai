import { useQuery } from "@tanstack/react-query"
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getAuthHeaders } from "@/lib/api"

// ============================================================
// Admin — Stuck Pipelines
// ============================================================
//
// Surfaces pipelines that have been silently `running` longer than the
// cutoff (default 30 min). Pairs with the GET /v1/admin/stuck-pipelines
// backend route. Use this when users report "my pipeline hasn't moved" —
// you'll see the row here with its stage + last activity timestamp.
//
// Common patterns to look for:
//   - status=running + current_stage=characters + reservedCredits > 0:
//     usually a manual-mode pipeline correctly paused at awaiting_approval
//     that the user didn't realize needed action (see "Your turn" banner
//     in EntityGrid for the matching UX fix).
//   - failure_reason set: pipeline failed but row wasn't transitioned to
//     `failed` — usually a worker crash. Investigate the worker logs.
//   - No current_stage + reservedCredits > 0: orchestrator never picked
//     up the pipeline. Check BullMQ queue health.

interface StuckPipeline {
  pipelineId: string
  userId: string
  status: string
  currentStage: string | null
  mode: string | null
  reservedCredits: number
  spentCredits: number
  createdAt: string
  updatedAt: string
  stuckForMinutes: number
  failureReason: string | null
}

interface StuckResponse {
  data: StuckPipeline[]
  total: number
  cutoffIso: string
  olderThanMinutes: number
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ${min % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

function stageVariant(stage: string | null): "default" | "secondary" | "outline" {
  if (!stage) return "outline"
  if (stage === "script") return "secondary"
  return "default"
}

export default function AdminStuckPipelinesPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin", "stuck-pipelines"],
    queryFn: async (): Promise<StuckResponse> => {
      const res = await fetch("/v1/admin/stuck-pipelines?olderThanMinutes=30&limit=200", {
        headers: { ...(await getAuthHeaders()) },
      })
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      return res.json()
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            Stuck Pipelines
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Pipelines with <code>status=running</code> whose last DB update is
            more than 30 minutes ago. A row here usually means one of:
            user paused at <code>awaiting_approval</code> and didn't notice,
            a worker crashed mid-stage, or the orchestrator never picked up
            the run.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3 mr-1" />
          )}
          Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      )}

      {isError && (
        <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-700 p-3 text-sm text-red-800 dark:text-red-200">
          Failed to load stuck pipelines. Check console for details.
        </div>
      )}

      {data && data.data.length === 0 && (
        <div className="rounded border border-green-300 bg-green-50 dark:bg-green-950 dark:border-green-700 p-4 text-sm text-green-800 dark:text-green-200">
          No stuck pipelines (cutoff: {data.olderThanMinutes} min). All
          running pipelines have updated within the window.
        </div>
      )}

      {data && data.data.length > 0 && (
        <div className="rounded border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Pipeline</th>
                <th className="px-3 py-2 font-medium">Stage</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 font-medium">Stuck for</th>
                <th className="px-3 py-2 font-medium">Credits</th>
                <th className="px-3 py-2 font-medium">Last update</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Failure reason</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.data.map((row) => (
                <tr key={row.pipelineId} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.pipelineId.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={stageVariant(row.currentStage)}>
                      {row.currentStage ?? "—"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.mode ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        row.stuckForMinutes > 60
                          ? "text-red-600 font-medium"
                          : "text-amber-700"
                      }
                    >
                      {fmtMinutes(row.stuckForMinutes)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.spentCredits}/{row.reservedCredits}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {fmtTime(row.updatedAt)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.userId.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2 text-xs text-red-700">
                    {row.failureReason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="text-xs text-muted-foreground mt-3">
          {data.total} pipeline{data.total === 1 ? "" : "s"} stuck longer than{" "}
          {data.olderThanMinutes} min · auto-refresh every 60s
        </div>
      )}
    </div>
  )
}
