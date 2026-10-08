import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AXIS_LABELS, CHIP_CHARS, type ActiveTarget, type LinkageCluster } from "./types"
import { detailSubline, planBlock } from "./linkage-model"
import { axisVar, ON_TIER, tierVar } from "./linkage-styles"
import { AxisDot } from "./linkage-marker"
import { useClusterMembers } from "./use-users-linkage"
import { BlockClusterPanel } from "./block-cluster-panel"

/**
 * The selected cluster: its number and size, when it was active, the keys its
 * members share (point at one to light every row holding it, click to pin),
 * and the two actions — back to all users, or block the whole cluster.
 *
 * The members are read when the card opens, not shipped with the list, so a
 * thousand-account NAT cluster costs the page nothing until someone looks.
 *
 * `canBlock` is the viewer's super-admin role. The per-account block route is
 * admin-gated, but blocking eighteen accounts from one button is a heavier
 * hammer than blocking one from its row, so it sits one notch higher — the
 * same notch the Access panel keeps for network blocks.
 */
export function ClusterDetailCard({
  cluster,
  onPage,
  active,
  pinned,
  onActive,
  onPin,
  onClose,
  canBlock,
  blockedIds,
  viewerId,
  onBlocked,
}: {
  readonly cluster: LinkageCluster
  readonly onPage: number
  readonly active: ActiveTarget | null
  readonly pinned: ActiveTarget | null
  readonly onActive: (target: ActiveTarget | null) => void
  readonly onPin: (target: ActiveTarget) => void
  readonly onClose: () => void
  readonly canBlock: boolean
  readonly blockedIds: ReadonlySet<string>
  readonly viewerId: string
  readonly onBlocked: () => void
}) {
  const [blocking, setBlocking] = useState(false)
  const [running, setRunning] = useState(false)
  const members = useClusterMembers(cluster.key)
  const color = tierVar(cluster.tier, "color")
  const plan = members.data ? planBlock(members.data.members, blockedIds, viewerId) : null

  return (
    <div
      data-testid="cluster-detail"
      className="mb-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[10px] border bg-card px-4 py-3"
      style={{ borderColor: color, borderInlineStartWidth: 4 }}
    >
      <span className="rounded px-1.5 py-0.5 text-xs font-bold" style={{ background: color, color: ON_TIER }}>
        #{cluster.id}
      </span>
      <div className="min-w-[220px] flex-1">
        <div className="whitespace-nowrap text-sm font-bold">{cluster.size} linked accounts</div>
        <div className="mt-px text-xs text-muted-foreground">{detailSubline(cluster, onPage)}</div>
      </div>

      <div className="order-2 flex basis-full flex-wrap gap-1.5">
        {cluster.keys.map((key) => {
          const target: ActiveTarget = { type: "key", axis: key.axis, token: key.token }
          const isHot = active?.type === "key" && active.axis === key.axis && active.token === key.token
          const isPinned = pinned?.type === "key" && pinned.axis === key.axis && pinned.token === key.token
          const on = isHot || isPinned
          return (
            <button
              key={`${key.axis}:${key.token}`}
              type="button"
              aria-pressed={isPinned}
              title={`${AXIS_LABELS[key.axis]} ${key.token} · ${key.count} accounts`}
              onMouseEnter={() => onActive(target)}
              onMouseLeave={() => onActive(null)}
              onClick={() => onPin(target)}
              className="inline-flex h-6 items-center gap-1.5 rounded-full border bg-card px-2 text-[11.5px] text-foreground/80 transition-colors"
              style={on ? { borderColor: axisVar(key.axis), background: axisVar(key.axis), color: ON_TIER } : undefined}
            >
              <AxisDot axis={key.axis} color={on ? ON_TIER : undefined} />
              {AXIS_LABELS[key.axis]}
              <span className="font-mono opacity-60">{key.token.slice(0, CHIP_CHARS)}</span>
              <b>{key.count}</b>
            </button>
          )
        })}
      </div>

      <div className="ms-auto flex items-center gap-2">
        {members.isError && (
          <span className="text-xs text-destructive">{members.error instanceof Error ? members.error.message : "Failed to load the cluster"}</span>
        )}
        <Button size="sm" variant="outline" disabled={running} onClick={onClose}>
          Show all users
        </Button>
        {canBlock && !blocking && (
          <Button size="sm" style={{ background: color, color: ON_TIER }} disabled={!plan} onClick={() => setBlocking(true)}>
            {members.isLoading && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
            {plan ? `Block ${plan.targets.length}` : "Block…"}
          </Button>
        )}
      </div>

      {canBlock && blocking && members.data && (
        <BlockClusterPanel
          cluster={cluster}
          members={members.data.members}
          blockedIds={blockedIds}
          viewerId={viewerId}
          onRunningChange={setRunning}
          onDone={onBlocked}
          onClose={() => setBlocking(false)}
        />
      )}
    </div>
  )
}
