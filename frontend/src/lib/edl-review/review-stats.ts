/**
 * The numbers the inspector shows about a review: the footer's lengths and the
 * reasons panel's rows (§2.3 of the inspectors design). Pure, and cheap enough
 * to run on every edit.
 *
 *  - Cut length: the rendered output's length, `edlDurationMs` of the effective
 *    EDL the render builds from the edit (its crossfade and sources applied).
 *    With a crossfade the cut is shorter than the kept time, by an amount the
 *    render settles, so it is shown as "≤" (`approximate`).
 *  - Source: the recording as the plan covers it, from 0 to the end of its last
 *    segment or dropped span.
 *  - Removed: source − the kept time.
 */
import { buildEffectiveEdl } from "@nodaro/render-rules"
import { edlDurationMs, type Edl } from "@nodaro/shared"
import { DROP_REASONS } from "./drop-reasons"
import { spanMinus, toIntervalSet, type Interval } from "./intervals"
import { MANUAL_REASON, type KeptSet } from "./kept-set"
import type { ReviewRenderContext } from "./restore"

export interface ReviewLengths {
  /** The cut's length on the output clock. */
  readonly outputMs: number
  /** True when a crossfade makes `outputMs` an upper bound ("≤"). */
  readonly approximate: boolean
  readonly sourceMs: number
  readonly removedMs: number
}

const measure = (set: readonly Interval[]): number => set.reduce((ms, p) => ms + (p.outMs - p.inMs), 0)

/** The end of the plan's last segment or dropped span. */
export function planSourceMs(base: Edl): number {
  let end = 0
  for (const s of base.segments) end = Math.max(end, s.outMs)
  for (const d of base.dropped ?? []) end = Math.max(end, d.outMs)
  return end
}

export function reviewLengths(base: Edl, edited: Edl, kept: KeptSet, render: ReviewRenderContext): ReviewLengths {
  const effective = buildEffectiveEdl(edited, { crossfadeMs: render.crossfadeMs, sourceOverrides: render.sources })
  const sourceMs = planSourceMs(base)
  return {
    outputMs: edlDurationMs(effective),
    approximate: render.crossfadeMs > 0,
    sourceMs,
    removedMs: Math.max(0, sourceMs - measure(kept)),
  }
}

/** A reason's box: every span of it cut, some restored, or all restored. */
export type ReasonState = "cut" | "partial" | "restored"

export interface ReasonStat {
  readonly reason: string
  /** How many spans the plan dropped for it, and their time. 0 for "manual". */
  readonly planSpans: number
  readonly planMs: number
  /** How many dropped spans of it the edit has, and their time. */
  readonly cutSpans: number
  readonly cutMs: number
  readonly state: ReasonState
}

/**
 * One row per reason present: every reason the plan dropped time for, in the
 * panel's order (`DROP_REASONS`, then any reason it does not know, as the plan
 * lists them), and "manual" last when the reviewer has cut something.
 */
export function reasonStats(base: Edl, edited: Edl, kept: KeptSet): ReasonStat[] {
  const order: string[] = []
  for (const d of base.dropped ?? []) if (d.reason !== MANUAL_REASON && !order.includes(d.reason)) order.push(d.reason)
  const known = DROP_REASONS.filter((r) => order.includes(r))
  const reasons = [...known, ...order.filter((r) => !(DROP_REASONS as readonly string[]).includes(r))]

  const rows: ReasonStat[] = reasons.map((reason) => {
    const planRows = (base.dropped ?? []).filter((d) => d.reason === reason)
    const spans = toIntervalSet(planRows)
    const planMs = measure(spans)
    const cutMs = spans.reduce((ms, span) => ms + measure(spanMinus(span, kept)), 0)
    return {
      reason,
      planSpans: planRows.length,
      planMs,
      cutSpans: (edited.dropped ?? []).filter((d) => d.reason === reason).length,
      cutMs,
      state: cutMs === 0 ? "restored" : cutMs >= planMs ? "cut" : "partial",
    }
  })
  const manual = (edited.dropped ?? []).filter((d) => d.reason === MANUAL_REASON)
  if (manual.length > 0) {
    rows.push({ reason: MANUAL_REASON, planSpans: 0, planMs: 0, cutSpans: manual.length, cutMs: measure(toIntervalSet(manual)), state: "cut" })
  }
  return rows
}
