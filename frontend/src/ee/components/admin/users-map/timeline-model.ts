import { formatSpan, STATES, type Acct, type ClusterView } from "./map-model"

/**
 * The sign-up timeline: one dot per account at its sign-up time. With a
 * cluster selected the axis rescales to that cluster's span, so a burst of
 * sign-ups minutes apart reads as a burst.
 */

export interface TimelineDot {
  readonly id: string
  /** Percent along the track. */
  readonly pos: number
  readonly size: number
  readonly color: string
  readonly selected: boolean
  readonly title: string
}

export interface Timeline {
  readonly title: string
  readonly dots: readonly TimelineDot[]
  readonly ticks: ReadonlyArray<{ readonly pos: number; readonly label: string }>
}

const UNLINKED_DOT = "#cfe6d6"
const TICKS = 4
const MIN_SPAN_MS = 60 * 60_000

export function formatStamp(t: number): string {
  return new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", " ·")
}

export function buildTimeline(
  accounts: readonly Acct[],
  cluster: ClusterView | null,
  selectedAccount: string | null,
): Timeline {
  const set = (cluster ? cluster.members : accounts).filter((a): a is Acct & { t: number } => a.t !== null)
  if (set.length === 0) return { title: cluster ? `#${cluster.id} · no sign-up times` : "No sign-up times", dots: [], ticks: [] }
  const t0 = Math.min(...set.map((a) => a.t))
  const t1 = Math.max(...set.map((a) => a.t))
  const span = Math.max(MIN_SPAN_MS, t1 - t0)
  const lo = t0 - span * 0.04
  const hi = t1 + span * 0.04
  const pos = (t: number) => ((t - lo) / (hi - lo)) * 100
  const title = cluster
    ? `#${cluster.id} · ${set.length} sign-ups in ${formatSpan(t1 - t0)}`
    : `All drawn sign-ups · ${set.length} accounts`
  const firstId = cluster ? set.reduce((a, b) => (b.t < a.t ? b : a)).id : null
  const dots = set.map((a) => {
    const selected = a.id === selectedAccount
    const size = selected ? 16 : a.id === firstId ? 14 : cluster ? 12 : 10
    return {
      id: a.id,
      pos: pos(a.t),
      size,
      color: a.cluster ? STATES[a.state].dot : UNLINKED_DOT,
      selected,
      title: `${a.email} · ${formatStamp(a.t)}`,
    }
  })
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / TICKS
    return { pos: pos(t), label: formatStamp(t) }
  })
  return { title, dots, ticks }
}
