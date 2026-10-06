import { parseCaptionPlan, type CaptionPlan } from "./caption-plan.js"
import { captionSegmentInputSchema, findSegmentOverlap } from "./caption-segment-schema.js"

/** The styling half, injected so this package never imports @nodaro/prompts (each engine passes hookPlateCaptionSegments). */
export interface CaptionPlanStyler {
  readonly segmentsFor: (
    plan: CaptionPlan,
    opts?: { bodyLevers?: Readonly<Record<string, unknown>> },
  ) => { segments: Record<string, unknown>[]; dropped: readonly string[] }
  readonly leverKeys: readonly string[]
}

/** The node's own caption levers (set, non-null) — the body's style. Undefined when it sets none (the helper then applies Body Captions). */
export function captionPlanBodyLevers(
  nodeData: Readonly<Record<string, unknown>>,
  leverKeys: readonly string[],
): Record<string, unknown> | undefined {
  const levers: Record<string, unknown> = {}
  for (const k of leverKeys) {
    const v = nodeData[k]
    if (v !== undefined && v !== null) levers[k] = v
  }
  return Object.keys(levers).length > 0 ? levers : undefined
}

/**
 * A wired caption plan → the timed segments of ONE add-captions request, checked
 * with the route's own segment schema and overlap rule (a DAG payload never
 * passes the route, so both engines check here, before any reservation). The
 * plate is always Hook Plate plus the plan's language levers; the body is the
 * node's own style (the helper's rules, SP7 §4.6.3). `segments: []` = no
 * captions — the caller passes the video through.
 */
export function styleCaptionPlan(
  raw: unknown,
  nodeData: Readonly<Record<string, unknown>>,
  styler: CaptionPlanStyler,
): { segments: Record<string, unknown>[] } | { error: string } {
  const parsed = parseCaptionPlan(raw)
  if ("error" in parsed) return { error: parsed.error }
  const bodyLevers = captionPlanBodyLevers(nodeData, styler.leverKeys)
  const { segments } = styler.segmentsFor(parsed.plan, bodyLevers ? { bodyLevers } : undefined)
  for (let i = 0; i < segments.length; i++) {
    const r = captionSegmentInputSchema.safeParse(segments[i])
    if (!r.success) return { error: `Caption plan: segment ${i + 1}: ${r.error.issues[0]?.message ?? "invalid"}.` }
  }
  const overlap = findSegmentOverlap(segments as { startMs: number; endMs: number }[])
  if (overlap) return { error: `Caption plan: ${overlap}.` }
  return { segments }
}
