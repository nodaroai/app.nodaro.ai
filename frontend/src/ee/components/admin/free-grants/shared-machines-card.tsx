import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fetchClusters } from "./api"
import {
  AXES,
  PAGE_LIMIT,
  REASON_LABELS,
  type Cluster,
  type ClusterAxis,
  type ClustersResponse,
} from "./types"

/**
 * Every signup key more than one account claimed from, on one axis at a time.
 *
 * The card tolerates the RPC not existing yet: staging runs this code for days
 * before migration 373 reaches the database, and the backend answers that with
 * `unavailable: true` rather than a 500.
 */
export function SharedMachinesCard() {
  const [axis, setAxis] = useState<ClusterAxis>("device")
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<ClustersResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    setLoading(true)
    // The previous page stays on screen while the next loads, so the pager
    // never unmounts under the cursor and a failed refetch leaves a way back.
    fetchClusters(axis, offset)
      .then((res) => {
        // The response echoes its axis so a fast tab-switch cannot paint the
        // previous axis's clusters over the one now selected.
        if (ignore || res.axis !== axis) return
        setResult(res)
      })
      .catch((err: unknown) => {
        if (ignore) return
        toast.error(err instanceof Error ? err.message : "Failed to load shared signals")
        setResult((prev) => prev ?? { data: [], total: 0, axis, unavailable: false })
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [axis, offset])

  return (
    <Card className="mt-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Shared machines &amp; networks
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Device and browser signatures are only captured on app.nodaro.ai — accounts created
          through the other Nodaro apps appear under Network only.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs
          value={axis}
          onValueChange={(value) => {
            setAxis(value as ClusterAxis)
            setOffset(0)
          }}
        >
          <TabsList>
            {AXES.map((a) => (
              <TabsTrigger key={a.value} value={a.value}>
                {a.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {result === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : result.unavailable ? (
          <p className="text-sm text-muted-foreground py-6">
            Not available until the next production release.
          </p>
        ) : result.data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">No shared signals on this axis.</p>
        ) : (
          <div className={`mt-4 space-y-4${loading ? " opacity-60" : ""}`}>
            {result.data.map((cluster) => (
              <ClusterBlock key={cluster.keyPrefix} cluster={cluster} />
            ))}
          </div>
        )}

        {result !== null && !result.unavailable && result.total > PAGE_LIMIT && (
          <div className="flex items-center justify-end gap-2 mt-4">
            <Button
              size="sm"
              variant="ghost"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              {offset + 1}–{Math.min(offset + PAGE_LIMIT, result.total)} of {result.total}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={offset + PAGE_LIMIT >= result.total}
              onClick={() => setOffset(offset + PAGE_LIMIT)}
            >
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ClusterBlock({ cluster }: { cluster: Cluster }) {
  const hidden = cluster.memberCount - cluster.members.length

  return (
    <div className="border rounded-md p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-sm">{cluster.keyPrefix}</span>
        <span className="text-xs text-muted-foreground">{cluster.memberCount} accounts</span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        First seen {new Date(cluster.firstSeenAt).toLocaleString()} · Last seen{" "}
        {new Date(cluster.lastSeenAt).toLocaleString()}
      </div>

      <table className="w-full text-sm mt-2">
        <tbody>
          {cluster.members.map((member) => (
            <tr key={member.userId} className="border-b last:border-0 align-top">
              <td className="py-1.5 pr-4">
                <div>{member.email ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {member.fullName ?? member.userId}
                </div>
              </td>
              <td className="py-1.5 pr-4">
                {member.state ? (
                  <Badge>{member.state}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-1.5 pr-4 text-right font-mono">{member.subscriptionCredits}</td>
              <td className="py-1.5">
                <div className="flex flex-wrap gap-1">
                  {member.reasons.map((r) => (
                    <Badge key={r} variant="outline" title={r}>
                      {REASON_LABELS[r] ?? r}
                    </Badge>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {hidden > 0 && (
        <div className="text-xs text-muted-foreground mt-2">+{hidden} more</div>
      )}
    </div>
  )
}
