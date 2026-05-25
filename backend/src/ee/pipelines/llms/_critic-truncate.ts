/**
 * Runtime safety net for critic LLM emits whose freeform string fields can
 * overshoot their schema caps. Used by image + video critics where Sonnet
 * occasionally emits an identified_subject / approved_summary / identified_action
 * longer than the cap declared in `packages/shared/src/pipeline-types.ts`.
 *
 * Without this helper, a 503-char string from Sonnet fails the entire
 * `callLLM` flow (Zod safeParse → retry once → still overshoots → throws),
 * the entity stage handler treats the throw as a generic image-critic
 * failure, and the user never sees what the critic actually said.
 *
 * With this helper: overshoots are truncated to `cap - 1` chars + "…",
 * logged via `console.warn` for telemetry (so we can calibrate caps over
 * time), and the verdict flows through to the user as normal.
 *
 * Schema caps stay as the hard correctness invariant. This helper is the
 * liveness guarantee on top.
 */

export interface TruncateContext {
  /** Pipeline id for log correlation. */
  pipelineId: string
  /** Critic role for log filtering (e.g. "character_image", "video_critic"). */
  role: string
}

/**
 * Walks `raw` and truncates any top-level string field whose length exceeds
 * the cap in `fieldCaps`. Non-string fields, missing fields, and within-cap
 * strings pass through unchanged. Each truncation is logged once via
 * `console.warn` with field name + original length + context.
 *
 * Returns a NEW object when any truncation happened (does not mutate `raw`).
 * Returns `raw` unchanged when no field needed truncation — cheap fast path.
 */
export function truncateCriticFields<T extends Record<string, unknown>>(
  raw: T,
  fieldCaps: Record<string, number>,
  ctx: TruncateContext,
): T {
  let next: Record<string, unknown> | null = null

  for (const [field, cap] of Object.entries(fieldCaps)) {
    const val = raw[field]
    if (typeof val !== "string") continue
    if (val.length <= cap) continue

    if (next === null) next = { ...raw }
    // Slice to cap-1 then append a single ellipsis char so the total stays
    // at exactly `cap`. The ellipsis signals to readers that text was cut.
    next[field] = val.slice(0, cap - 1) + "…"

    console.warn(
      "[critic-truncate]",
      JSON.stringify({
        role: ctx.role,
        pipelineId: ctx.pipelineId,
        field,
        originalLen: val.length,
        cap,
      }),
    )
  }

  return (next ?? raw) as T
}
