"use client"

import { useEffect, useState } from "react"
import { Loader2, Activity, CheckCircle, XCircle, Percent, Image, Video, Clock, Zap } from "lucide-react"
import { getStats, type StatsResponse } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { cn } from "@/lib/utils"

interface StatCardProps {
  readonly label: string
  readonly value: string | number
  readonly icon: React.ReactNode
  readonly colorClass?: string
  readonly loading?: boolean
}

function StatCard({ label, value, icon, colorClass, loading }: StatCardProps) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={cn("p-1.5 rounded-md", colorClass ?? "bg-muted")}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted-foreground">{label}</p>
          {loading ? (
            <div className="h-5 flex items-center">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <p className="text-base font-semibold">{value}</p>
          )}
        </div>
      </div>
    </div>
  )
}

interface StatsOverviewProps {
  readonly className?: string
}

export function StatsOverview({ className }: StatsOverviewProps) {
  const { user, isAdmin } = useAuth()
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<"user" | "platform">("user")

  useEffect(() => {
    async function fetchStats() {
      if (!user) return

      setLoading(true)
      setError(null)

      try {
        const userIdToSend = scope === "user" ? user.id : undefined
        console.log("[stats-overview] Fetching stats:", { scope, userId: userIdToSend, isAdmin })
        const result = await getStats(scope, userIdToSend)
        console.log("[stats-overview] Stats result:", result.data)
        setStats(result.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch stats")
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [user, scope, isAdmin])

  if (error) {
    return (
      <div className={cn("text-center py-4 text-muted-foreground text-sm", className)}>
        {error}
      </div>
    )
  }

  const formatTime = (seconds: number | null) => {
    if (seconds === null) return "-"
    return `${seconds}s`
  }

  return (
    <div className={className}>
      {isAdmin && (
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => setScope("user")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              scope === "user"
                ? "bg-[#ff0073] text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            My Stats
          </button>
          <button
            type="button"
            onClick={() => setScope("platform")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              scope === "platform"
                ? "bg-[#ff0073] text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            Platform Stats
          </button>
        </div>
      )}

      {/* Pending/Processing badges */}
      {stats && ((stats.pending ?? 0) > 0 || (stats.processing ?? 0) > 0) && (
        <div className="flex items-center gap-2 mb-3">
          {(stats.pending ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400">
              <Clock className="w-3 h-3" />
              {stats.pending} pending
            </span>
          )}
          {(stats.processing ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
              <Zap className="w-3 h-3" />
              {stats.processing} processing
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatCard
          label="Executions"
          value={(stats?.totalExecutions ?? 0).toLocaleString()}
          icon={<Activity className="h-3.5 w-3.5 text-[#ff0073]" />}
          colorClass="bg-[#ff0073]/10"
          loading={loading}
        />
        <StatCard
          label="Successful"
          value={(stats?.successful ?? 0).toLocaleString()}
          icon={<CheckCircle className="h-3.5 w-3.5 text-green-500" />}
          colorClass="bg-green-500/10"
          loading={loading}
        />
        <StatCard
          label="Failed"
          value={(stats?.failed ?? 0).toLocaleString()}
          icon={<XCircle className="h-3.5 w-3.5 text-red-500" />}
          colorClass="bg-red-500/10"
          loading={loading}
        />
        <StatCard
          label="Failure Rate"
          value={`${stats?.failureRate ?? 0}%`}
          icon={<Percent className="h-3.5 w-3.5 text-orange-500" />}
          colorClass="bg-orange-500/10"
          loading={loading}
        />
        <StatCard
          label="Avg. Image"
          value={formatTime(stats?.avgImageTime ?? null)}
          icon={<Image className="h-3.5 w-3.5 text-blue-500" />}
          colorClass="bg-blue-500/10"
          loading={loading}
        />
        <StatCard
          label="Avg. Video"
          value={formatTime(stats?.avgVideoTime ?? null)}
          icon={<Video className="h-3.5 w-3.5 text-purple-500" />}
          colorClass="bg-purple-500/10"
          loading={loading}
        />
      </div>
    </div>
  )
}
