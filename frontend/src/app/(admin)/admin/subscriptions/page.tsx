import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, HeartPulse, RefreshCw, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { getAuthHeaders } from "@/lib/api"

interface SubscriptionIssue {
  userId: string
  email: string | null
  tier: string
  issueType: "stale_period" | "missing_subscription" | "orphan_subscription" | "tier_mismatch"
  description: string
  dbPeriodEnd: string | null
  stripePeriodEnd: string | null
  stripeSubscriptionId: string | null
}

interface HealthData {
  issues: SubscriptionIssue[]
  scannedUsers: number
}

const ISSUE_LABELS: Record<string, { label: string; color: string }> = {
  stale_period: { label: "Stale Period", color: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  missing_subscription: { label: "Missing Sub", color: "bg-red-500/10 text-red-500 border-red-500/20" },
  orphan_subscription: { label: "Orphan Sub", color: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
  tier_mismatch: { label: "Tier Mismatch", color: "bg-orange-500/10 text-orange-500 border-orange-500/20" },
}

export default function AdminSubscriptionsPage() {
  const queryClient = useQueryClient()
  const [syncingUser, setSyncingUser] = useState<string | null>(null)

  const { data, isLoading, error, refetch, isFetching } = useQuery<{ data: HealthData }>({
    queryKey: ["admin", "subscription-health"],
    queryFn: async () => {
      const headers = await getAuthHeaders()
      const res = await fetch("/v1/admin/subscription-health", { headers })
      if (!res.ok) throw new Error("Failed to fetch subscription health")
      return res.json()
    },
  })

  const syncMutation = useMutation({
    mutationFn: async (userId: string) => {
      const authHeaders = await getAuthHeaders()
      const res = await fetch("/v1/admin/subscription-health/sync", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? "Sync failed")
      }
      return res.json()
    },
    onSuccess: (result, userId) => {
      const synced = result?.data
      toast.success(`Synced: ${synced?.tier} tier, renews ${new Date(synced?.periodEnd).toLocaleDateString()}`)
      setSyncingUser(null)
      queryClient.invalidateQueries({ queryKey: ["admin", "subscription-health"] })
    },
    onError: (err: Error) => {
      toast.error(err.message)
      setSyncingUser(null)
    },
  })

  const health = data?.data
  const issues = health?.issues ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <HeartPulse className="w-8 h-8" />
            Subscription Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Detect and fix sync issues between Stripe and the database
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Scan
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-red-500">
          {error instanceof Error ? error.message : "Failed to load"}
        </div>
      )}

      {health && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Paid Users Scanned</p>
              <p className="text-2xl font-bold">{health.scannedUsers}</p>
            </div>
            <div className={`rounded-lg border p-4 ${issues.length > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-green-500/30 bg-green-500/5"}`}>
              <p className="text-sm text-muted-foreground">Issues Found</p>
              <p className={`text-2xl font-bold ${issues.length > 0 ? "text-amber-500" : "text-green-500"}`}>
                {issues.length}
              </p>
            </div>
          </div>

          {/* Issues list */}
          {issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <p className="text-lg font-medium">All subscriptions in sync</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">User</th>
                    <th className="text-left p-3 font-medium">Tier</th>
                    <th className="text-left p-3 font-medium">Issue</th>
                    <th className="text-left p-3 font-medium">Details</th>
                    <th className="text-right p-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue, i) => {
                    const badge = ISSUE_LABELS[issue.issueType] ?? ISSUE_LABELS.stale_period
                    const isSyncing = syncingUser === issue.userId && syncMutation.isPending
                    return (
                      <tr key={`${issue.userId}-${issue.issueType}-${i}`} className="border-b last:border-0">
                        <td className="p-3">
                          <p className="font-mono text-xs truncate max-w-[180px]">{issue.email ?? issue.userId}</p>
                        </td>
                        <td className="p-3">
                          <span className="capitalize">{issue.tier}</span>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${badge.color}`}>
                            <AlertTriangle className="w-3 h-3" />
                            {badge.label}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground text-xs max-w-[300px] truncate">
                          {issue.description}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isSyncing}
                            onClick={() => {
                              setSyncingUser(issue.userId)
                              syncMutation.mutate(issue.userId)
                            }}
                          >
                            {isSyncing ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>
                                <ArrowRight className="w-3.5 h-3.5 mr-1" />
                                Sync from Stripe
                              </>
                            )}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
