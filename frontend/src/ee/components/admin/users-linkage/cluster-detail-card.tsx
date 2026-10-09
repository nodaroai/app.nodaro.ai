import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AXIS_LABELS, CHIP_CHARS, type ActiveTarget, type KeyRef, type LinkageCluster, type LinkageMember } from "./types"
import { detailSubline, membersOnKey, planBlock, planRevoke, scopeLabel } from "./linkage-model"
import { axisVar, ON_TIER, tierVar } from "./linkage-styles"
import { AxisDot } from "./linkage-marker"
import { useClusterMembers } from "./use-users-linkage"
import { ClusterActionPanel, type ClusterAction } from "./cluster-action-panel"

/**
 * The selected cluster: its number and size, when it was active, the keys its
 * members share (point at one to light every row holding it, click to pin),
 * and the actions — back to all users, block, or take the free credits back.
 *
 * The members are read when the card opens, not shipped with the list, so a
 * thousand-account NAT cluster costs the page nothing until someone looks.
 *
 * A PINNED KEY NARROWS THE ACTIONS. A cluster is everything joined by ANY
 * shared key, transitively — too wide a net to act on blindly. Pin one key
 * (click its chip) and the actions take only the accounts holding it: the
 * thirteen on one network, not the sixty-nine they are chained to.
 *
 * `canAct` is the viewer's super-admin role. Blocking or taking credits from
 * many accounts at once is a heavier hammer than one row's buttons, so it
 * sits one notch higher — the same notch the Access panel keeps for network
 * blocks. The server keeps its own gates (take-back is platform-operator).
 */
export function ClusterDetailCard({
  cluster,
  onPage,
  active,
  pinned,
  onActive,
  onPin,
  onClose,
  canAct,
  blockedIds,
  viewerId,
  onChanged,
}: {
  readonly cluster: LinkageCluster
  readonly onPage: number
  readonly active: ActiveTarget | null
  readonly pinned: ActiveTarget | null
  readonly onActive: (target: ActiveTarget | null) => void
  readonly onPin: (target: ActiveTarget) => void
  readonly onClose: () => void
  readonly canAct: boolean
  readonly blockedIds: ReadonlySet<string>
  readonly viewerId: string
  readonly onChanged: () => void
}) {
  const [action, setAction] = useState<ClusterAction | null>(null)
  const [running, setRunning] = useState(false)
  const members = useClusterMembers(cluster.key)
  const color = tierVar(cluster.tier, "color")

  const pinnedKey: KeyRef | null = pinned?.type === "key" ? { axis: pinned.axis, token: pinned.token } : null
  const all: readonly LinkageMember[] | null = members.data?.members ?? null
  const onPinned = all && pinnedKey ? membersOnKey(all, pinnedKey) : null
  // A key pinned elsewhere, held by nobody here, does not empty the actions.
  const scoped = onPinned && onPinned.length > 0 ? onPinned : all
  const scope = scoped && onPinned && onPinned.length > 0 && pinnedKey ? scopeLabel(pinnedKey, onPinned.length) : null
  const blockPlan = scoped ? planBlock(scoped, blockedIds, viewerId) : null
  const revokePlan = scoped ? planRevoke(scoped) : null

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

      <div className="order-2 flex basis-full flex-wrap items-center gap-1.5">
        {cluster.keys.map((key) => {
          const target: ActiveTarget = { type: "key", axis: key.axis, token: key.token }
          const isHot = active?.type === "key" && active.axis === key.axis && active.token === key.token
          const isPinned = pinnedKey?.axis === key.axis && pinnedKey.token === key.token
          const on = isHot || isPinned
          return (
            <button
              key={`${key.axis}:${key.token}`}
              type="button"
              aria-pressed={isPinned}
              title={`${AXIS_LABELS[key.axis]} ${key.token} · ${key.count} accounts — click to act on these only`}
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
        {scope && (
          <span className="text-xs text-muted-foreground" data-testid="action-scope">
            Acting on {scope} — click the chip again for the whole cluster.
          </span>
        )}
      </div>

      <div className="ms-auto flex items-center gap-2">
        {members.isError && (
          <span className="text-xs text-destructive">{members.error instanceof Error ? members.error.message : "Failed to load the cluster"}</span>
        )}
        <Button size="sm" variant="outline" disabled={running} onClick={onClose}>
          Show all users
        </Button>
        {canAct && action === null && (
          <>
            <Button size="sm" variant="outline" disabled={!revokePlan || revokePlan.targets.length === 0} onClick={() => setAction("revoke")}>
              {members.isLoading && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
              {revokePlan ? `Take back ${revokePlan.targets.length}` : "Take back…"}
            </Button>
            <Button size="sm" style={{ background: color, color: ON_TIER }} disabled={!blockPlan || blockPlan.targets.length === 0} onClick={() => setAction("block")}>
              {blockPlan ? `Block ${blockPlan.targets.length}` : "Block…"}
            </Button>
          </>
        )}
      </div>

      {canAct && action !== null && scoped && (
        <ClusterActionPanel
          action={action}
          cluster={cluster}
          scopeLabel={scope}
          members={scoped}
          blockedIds={blockedIds}
          viewerId={viewerId}
          onRunningChange={setRunning}
          onDone={onChanged}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  )
}
