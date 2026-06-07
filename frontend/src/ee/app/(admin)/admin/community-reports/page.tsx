import { useState } from "react"
import { Loader2, Trash2, ExternalLink, AlertTriangle } from "lucide-react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getCommunityReports, takedownCommunityListing } from "@/lib/api"

// Mirrors the backend report enum in backend/src/ee/routes/community.ts
// (real_person_no_consent | inappropriate | ip_violation | other).
const REASON_LABELS: Record<string, string> = {
  real_person_no_consent: "Real person (no consent)",
  inappropriate: "Inappropriate",
  ip_violation: "IP violation",
  other: "Other",
}

// real_person_no_consent is fast-tracked to the top per the safety design.
const PRIORITY_REASON = "real_person_no_consent"

interface CommunityListingRef {
  readonly id?: string
  readonly slug?: string
  readonly title?: string
  readonly entity_type?: string
}

interface CommunityReport {
  readonly id: string
  readonly listing_id: string
  readonly reporter_id: string | null
  readonly reason: string
  readonly created_at: string
  readonly community_listings: CommunityListingRef | null
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function ReasonBadge({ reason }: { readonly reason: string }) {
  const isPriority = reason === PRIORITY_REASON
  const label = REASON_LABELS[reason] ?? reason
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        isPriority
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : reason === "ip_violation"
            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            : reason === "inappropriate"
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
      )}
    >
      {isPriority && <AlertTriangle className="h-3 w-3" />}
      {label}
    </span>
  )
}

export default function AdminCommunityReportsPage() {
  const queryClient = useQueryClient()
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const { data, isLoading: loading } = useQuery({
    queryKey: ["admin", "community-reports"],
    queryFn: getCommunityReports,
  })

  const takedownMut = useMutation({
    mutationFn: (listingId: string) => takedownCommunityListing(listingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "community-reports"] })
      toast.success("Listing taken down")
    },
    onError: () => {
      toast.error("Failed to take down listing")
    },
    onSettled: () => {
      setActionLoading(null)
    },
  })

  const reports = (data?.data ?? []) as unknown as readonly CommunityReport[]

  // Fast-track real_person_no_consent reports to the top; keep recency order
  // (the API already returns created_at DESC) within each group.
  const sortedReports = [...reports].sort((a, b) => {
    const aPriority = a.reason === PRIORITY_REASON ? 0 : 1
    const bPriority = b.reason === PRIORITY_REASON ? 0 : 1
    return aPriority - bPriority
  })

  function handleTakedown(listingId: string) {
    setActionLoading(listingId)
    takedownMut.mutate(listingId)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Community Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review reported community listings and take down anything that violates policy
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
          {reports.length} open report{reports.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card animate-pulse"
            />
          ))}
        </div>
      ) : sortedReports.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <p className="text-lg">No open reports</p>
          <p className="text-sm mt-1">Reported community listings will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedReports.map((report) => {
            const listing = report.community_listings
            const title = listing?.title ?? "(deleted listing)"
            const slug = listing?.slug
            const entityType = listing?.entity_type
            const isProcessing = actionLoading === report.listing_id

            return (
              <div
                key={report.id}
                className={cn(
                  "rounded-lg border bg-card p-4",
                  report.reason === PRIORITY_REASON
                    ? "border-red-300 dark:border-red-900"
                    : "border-zinc-200 dark:border-zinc-800",
                )}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ReasonBadge reason={report.reason} />
                      {entityType && (
                        <span className="text-xs text-muted-foreground capitalize">{entityType}</span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {formatDate(report.created_at)}
                      </span>
                    </div>

                    <p className="mt-1.5 text-sm font-medium text-foreground truncate">
                      {title}
                    </p>

                    {slug && (
                      <Link
                        to={`/explore?listing=${encodeURIComponent(slug)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View listing
                      </Link>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-red-600 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20"
                        onClick={() => handleTakedown(report.listing_id)}
                        disabled={isProcessing}
                      >
                        {isProcessing ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Trash2 className="h-3 w-3 mr-1" />
                        )}
                        Take down
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
