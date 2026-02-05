"use client"

import { useEffect, useState } from "react"
import { Loader2, Activity, CheckCircle, XCircle, Percent, Image, Video } from "lucide-react"
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
        const result = await getStats(scope, scope === "user" ? user.id : undefined)
        setStats(result.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch stats")
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [user, scope])

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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatCard
          label="Executions"
          value={stats?.totalExecutions ?? 0}
          icon={<Activity className="h-3.5 w-3.5 text-[#ff0073]" />}
          colorClass="bg-[#ff0073]/10"
          loading={loading}
        />
        <StatCard
          label="Successful"
          value={stats?.successful ?? 0}
          icon={<CheckCircle className="h-3.5 w-3.5 text-green-500" />}
          colorClass="bg-green-500/10"
          loading={loading}
        />
        <StatCard
          label="Failed"
          value={stats?.failed ?? 0}
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
