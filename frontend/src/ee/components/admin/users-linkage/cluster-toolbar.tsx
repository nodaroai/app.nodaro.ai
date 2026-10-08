import { useEffect, useRef, useState } from "react"
import { ChevronDown, X } from "lucide-react"
import {
  AXIS_LABELS,
  CHIP_CHARS,
  INLINE_PILLS,
  TIERS,
  type ActiveTarget,
  type LinkageCluster,
  type LinkageResponse,
  type UsersById,
} from "./types"
import { clusterSpan, isClusterHot, summaryLine } from "./linkage-model"
import { axisVar, ON_TIER, tierVar } from "./linkage-styles"
import { AxisDot, TierSwatch } from "./linkage-marker"

/**
 * Above the table: what the linkage check found, the size-tier legend, the
 * "Flagged only" switch and one pill per cluster — the biggest inline, the
 * rest folded into a menu. Pointing at a pill lights the cluster's rows;
 * clicking it filters the table to them and opens the cluster card. A pinned
 * key shows here too, with the one way to let it go.
 */
export function ClusterToolbar({
  linkage,
  users,
  active,
  onActive,
  selectedKey,
  onSelect,
  onlyFlagged,
  onToggleFlagged,
  pinned,
  onUnpin,
  inlineMax = INLINE_PILLS,
}: {
  readonly linkage: LinkageResponse
  readonly users: UsersById
  readonly active: ActiveTarget | null
  readonly onActive: (target: ActiveTarget | null) => void
  readonly selectedKey: string | null
  readonly onSelect: (clusterKey: string) => void
  readonly onlyFlagged: boolean
  readonly onToggleFlagged: () => void
  readonly pinned: ActiveTarget | null
  readonly onUnpin: () => void
  readonly inlineMax?: number
}) {
  const inline = linkage.clusters.slice(0, inlineMax)
  const folded = linkage.clusters.slice(inlineMax)

  return (
    <div className="mb-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
        <span className="font-bold text-foreground">Linked-account clusters</span>
        <span>{summaryLine(linkage.summary)}</span>
        {linkage.partial && <span className="text-xs">(newest clusters only)</span>}
        <div className="ms-auto flex items-center gap-2.5 text-[11.5px]">
          {TIERS.map(({ tier, label }) => (
            <span key={tier} className="inline-flex items-center gap-1.5">
              <TierSwatch tier={tier} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {linkage.clusters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={onlyFlagged}
            onClick={onToggleFlagged}
            className={`h-7 flex-none rounded-[7px] border px-2.5 text-[12.5px] font-semibold transition-colors ${
              onlyFlagged ? "border-foreground bg-foreground text-background" : "bg-card text-foreground/80 hover:bg-muted"
            }`}
          >
            Flagged only
          </button>
          <span aria-hidden className="mx-1 h-5 w-px flex-none bg-border" />
          {inline.map((cluster) => (
            <ClusterPill
              key={cluster.key}
              cluster={cluster}
              hot={isClusterHot(active, cluster, users)}
              selected={selectedKey === cluster.key}
              onActive={onActive}
              onSelect={onSelect}
            />
          ))}
          {folded.length > 0 && (
            <FoldedClustersMenu
              clusters={folded}
              selected={folded.find((c) => c.key === selectedKey) ?? null}
              onActive={onActive}
              onSelect={onSelect}
            />
          )}
          {pinned?.type === "key" && (
            <button
              type="button"
              aria-label={`Unpin ${AXIS_LABELS[pinned.axis]} ${pinned.token.slice(0, CHIP_CHARS)}`}
              onClick={onUnpin}
              className="ms-auto inline-flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5 text-[12.5px]"
              style={{ borderColor: axisVar(pinned.axis), background: axisVar(pinned.axis), color: ON_TIER }}
            >
              <AxisDot axis={pinned.axis} color={ON_TIER} />
              Pinned: {AXIS_LABELS[pinned.axis]} <span className="font-mono">{pinned.token.slice(0, CHIP_CHARS)}</span>
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ClusterPill({
  cluster,
  hot,
  selected,
  onActive,
  onSelect,
}: {
  readonly cluster: LinkageCluster
  readonly hot: boolean
  readonly selected: boolean
  readonly onActive: (target: ActiveTarget | null) => void
  readonly onSelect: (clusterKey: string) => void
}) {
  const color = tierVar(cluster.tier, "color")
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Cluster #${cluster.id}, ${cluster.size} accounts`}
      onMouseEnter={() => onActive({ type: "cluster", clusterId: cluster.id })}
      onMouseLeave={() => onActive(null)}
      onClick={() => onSelect(cluster.key)}
      className="inline-flex h-7 flex-none items-center gap-1.5 rounded-[7px] border bg-card pe-2.5 ps-2 text-[12.5px] text-foreground tabular-nums transition-colors"
      style={{
        borderColor: selected || hot ? color : undefined,
        background: selected ? color : undefined,
        color: selected ? ON_TIER : undefined,
      }}
    >
      <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: selected ? ON_TIER : color }} />
      #{cluster.id}
      <span className="font-bold" style={{ color: selected ? ON_TIER : color }}>
        {cluster.size}
      </span>
    </button>
  )
}

/** The smaller clusters, in a list the admin opens on demand. Closes on a click anywhere else. */
function FoldedClustersMenu({
  clusters,
  selected,
  onActive,
  onSelect,
}: {
  readonly clusters: readonly LinkageCluster[]
  readonly selected: LinkageCluster | null
  readonly onActive: (target: ActiveTarget | null) => void
  readonly onSelect: (clusterKey: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const label = selected
    ? `#${selected.id} · ${selected.size}`
    : `${clusters.length} more ${clusters.length === 1 ? "cluster" : "clusters"}`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 flex-none items-center gap-1.5 rounded-[7px] border bg-card px-2.5 text-[12.5px] font-semibold text-foreground ${
          open || selected ? "border-foreground" : ""
        }`}
      >
        {label}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Smaller clusters"
          className="absolute start-0 top-[34px] z-20 max-h-80 w-[300px] overflow-y-auto rounded-[10px] border bg-popover p-1.5 shadow-lg"
        >
          <div className="px-3 pb-1 pt-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Smaller clusters</div>
          {clusters.map((cluster) => {
            const isSelected = selected?.key === cluster.key
            return (
              <button
                key={cluster.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => onActive({ type: "cluster", clusterId: cluster.id })}
                onMouseLeave={() => onActive(null)}
                onClick={() => {
                  onSelect(cluster.key)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-start text-[13px] text-foreground ${
                  isSelected ? "bg-muted" : "hover:bg-muted/60"
                }`}
              >
                <TierSwatch tier={cluster.tier} />
                <span className="min-w-[30px] font-semibold">#{cluster.id}</span>
                <span className="text-xs text-muted-foreground">
                  {clusterSpan(cluster)} · {cluster.withheld} withheld
                </span>
                <span className="ms-auto font-bold tabular-nums" style={{ color: tierVar(cluster.tier, "color") }}>
                  {cluster.size}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
