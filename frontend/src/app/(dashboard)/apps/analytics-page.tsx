import { useState } from "react"
import { useParams, Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowLeft,
  Loader2,
  Activity,
  Users,
  Coins,
  CheckCircle2,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  getAppAnalytics,
  getAppAnalyticsRuns,
  type AnalyticsPeriod,
  type DailyAnalytics,
  type AnalyticsRun,
} from "@/lib/api"

export default function AppAnalyticsPage() {
  const { appId } = useParams<{ appId: string }>()
  const [period, setPeriod] = useState<"today" | "last7Days" | "last30Days" | "allTime">("last7Days")
  const [runsCursor, setRunsCursor] = useState<string | undefined>()

  const { data: analytics, isLoading } = useQuery({
    queryKey: ["app-analytics", appId],
    queryFn: () => getAppAnalytics(appId!),
    enabled: !!appId,
  })

  const { data: runsPage, isLoading: runsLoading } = useQuery({
    queryKey: ["app-analytics-runs", appId, runsCursor],
    queryFn: () => getAppAnalyticsRuns(appId!, runsCursor),
    enabled: !!appId,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!analytics) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <p className="text-muted-foreground">No analytics data available.</p>
      </div>
    )
  }

  const currentPeriod = analytics[period]

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/apps">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">App Analytics</h1>
          <p className="text-sm text-muted-foreground">Performance metrics for your published app</p>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-fit mb-6">
        {(["today", "last7Days", "last30Days", "allTime"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              period === p
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p === "today" ? "Today" : p === "last7Days" ? "7 Days" : p === "last30Days" ? "30 Days" : "All Time"}
          </button>
        ))}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        <StatCard icon={Activity} label="Total Runs" value={currentPeriod.totalRuns} />
        <StatCard icon={Users} label="Unique Runners" value={currentPeriod.uniqueRunners} />
        <StatCard icon={Coins} label="Credits Used" value={currentPeriod.totalCredits} />
        <StatCard icon={CheckCircle2} label="Successful" value={currentPeriod.successfulRuns} color="text-emerald-500" />
        <StatCard icon={XCircle} label="Failed" value={currentPeriod.failedRuns} color="text-red-500" />
      </div>

      {/* Daily chart (simple bar representation) */}
      {analytics.daily.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-3">Daily Runs (Last 30 days)</h2>
          <DailyChart data={analytics.daily} />
        </div>
      )}

      {/* Recent runs table */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Recent Runs</h2>
        {runsLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Time</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Progress</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {(runsPage?.data ?? []).map((run) => (
                    <tr key={run.id} className="border-t border-border/50">
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {new Date(run.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <RunStatusBadge status={run.status} />
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {run.completedNodes}/{run.totalNodes}
                      </td>
                      <td className="px-4 py-2 text-xs text-right text-muted-foreground">
                        {run.creditsUsed}
                      </td>
                    </tr>
                  ))}
                  {(!runsPage?.data || runsPage.data.length === 0) && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-xs text-muted-foreground">
                        No runs yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {runsPage?.nextCursor && (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRunsCursor(runsPage.nextCursor!)}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  color?: string
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${color ?? "text-muted-foreground"}`} />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className="text-2xl font-bold text-foreground">{value.toLocaleString()}</span>
    </div>
  )
}

function DailyChart({ data }: { data: DailyAnalytics[] }) {
  const maxRuns = Math.max(...data.map((d) => d.totalRuns), 1)

  return (
    <div className="flex items-end gap-0.5 h-24 bg-muted/20 rounded-lg p-3">
      {data.slice().reverse().map((day) => {
        const height = (day.totalRuns / maxRuns) * 100
        return (
          <div
            key={day.date}
            className="flex-1 min-w-0 group relative"
            title={`${day.date}: ${day.totalRuns} runs`}
          >
            <div
              className="w-full bg-[#ff0073]/60 hover:bg-[#ff0073] rounded-sm transition-colors"
              style={{ height: `${Math.max(height, 2)}%` }}
            />
          </div>
        )
      })}
    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "bg-emerald-500/10 text-emerald-500",
    failed: "bg-red-500/10 text-red-500",
    running: "bg-blue-500/10 text-blue-500",
    pending: "bg-yellow-500/10 text-yellow-500",
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colors[status] ?? "text-muted-foreground"}`}>
      {status}
    </span>
  )
}
