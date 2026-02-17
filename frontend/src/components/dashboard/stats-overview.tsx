import { useState, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Activity, CheckCircle, XCircle, Percent, Image, Video, Clock, Zap } from "lucide-react"
import { cancelAllJobs } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { useStats } from "@/hooks/queries/use-stats-queries"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

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
  const qc = useQueryClient()
  const [scope, setScope] = useState<"user" | "platform">("user")
  const [cancelAllDialogOpen, setCancelAllDialogOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const { data: stats, isLoading: loading, error } = useStats(scope, user?.id)

  const handleCancelAll = useCallback(async () => {
    if (!user) return

    setCancelling(true)
    try {
      await cancelAllJobs(user.id)
      qc.invalidateQueries({ queryKey: queryKeys.stats.all })
    } catch {
      // Error is silently swallowed; the dialog will close and the user can retry
    } finally {
      setCancelling(false)
      setCancelAllDialogOpen(false)
    }
  }, [user, qc])

  if (error) {
    return (
      <div className={cn("text-center py-4 text-muted-foreground text-sm", className)}>
        {error instanceof Error ? error.message : "Failed to fetch stats"}
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

      {/* Pending/Processing badges with Cancel All button */}
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
          {/* Cancel All button - only show on "My Stats" view */}
          {scope === "user" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              onClick={() => setCancelAllDialogOpen(true)}
              disabled={cancelling}
            >
              {cancelling ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <XCircle className="w-3 h-3 mr-1" />
              )}
              Cancel All
            </Button>
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

      {/* Cancel All Confirmation Dialog */}
      <AlertDialog open={cancelAllDialogOpen} onOpenChange={setCancelAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel all pending jobs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel {(stats?.pending ?? 0) + (stats?.processing ?? 0)} job{(stats?.pending ?? 0) + (stats?.processing ?? 0) !== 1 ? "s" : ""} that are currently pending or processing.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep Running</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelAll}
              disabled={cancelling}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {cancelling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Cancelling...
                </>
              ) : (
                "Cancel All Jobs"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
