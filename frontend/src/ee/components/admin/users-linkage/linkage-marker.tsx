import { AXIS_LABELS, type LinkageAxis, type SizeTier } from "./types"
import { axisVar, decisionVars, ON_TIER, tierVar, type DecisionKind } from "./linkage-styles"

/** The small marks a flagged row carries in its Email cell. */

export function FlagBadge({ clusterId, tier }: { readonly clusterId: number; readonly tier: SizeTier }) {
  return (
    <span
      data-testid="cluster-flag"
      title="Linked-account cluster"
      className="inline-flex h-4 min-w-4 flex-none items-center justify-center rounded px-1 text-[10px] font-extrabold tracking-wide"
      style={{ background: tierVar(tier, "color"), color: ON_TIER }}
    >
      #{clusterId}
    </span>
  )
}

const DECISION_KINDS: ReadonlySet<string> = new Set<DecisionKind>(["withheld", "granted", "revoked"])

/** The grant's state, as the mock shows it: WITHHELD amber, GRANTED red, taken back grey. */
export function DecisionChip({ decision }: { readonly decision: string }) {
  if (!DECISION_KINDS.has(decision)) return null
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide"
      style={decisionVars(decision as DecisionKind)}
    >
      {decision}
    </span>
  )
}

export function AxisDot({ axis, color }: { readonly axis: LinkageAxis; readonly color?: string }) {
  return (
    <span
      aria-hidden
      title={AXIS_LABELS[axis]}
      className="inline-block h-2 w-2 flex-none rounded-full"
      style={{ background: color ?? axisVar(axis) }}
    />
  )
}

export function TierSwatch({ tier }: { readonly tier: SizeTier }) {
  return <span aria-hidden className="inline-block h-2 w-2 flex-none rounded-[2px]" style={{ background: tierVar(tier, "color") }} />
}

/** "shares device + network" — on every row linked to what the admin points at. */
export function SharedChip({ axes, label }: { readonly axes: readonly LinkageAxis[]; readonly label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pe-2 ps-1.5 text-[11px] text-muted-foreground">
      {axes.map((axis) => (
        <AxisDot key={axis} axis={axis} />
      ))}
      {label}
    </span>
  )
}
