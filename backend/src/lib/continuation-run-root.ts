/**
 * The ROOT of a continuation chain: the first run of a run and every run that
 * continued it (`continueFromExecutionId`), however many generations deep.
 *
 * A published app's run names itself to UGC Clip (`runKey`), so two app runs
 * never share a clip. A continuation of an app run (its Render final, a
 * use-case node continued from its failure inside it) is the same run going
 * on, so it names the chain's root instead: a clip its earlier attempt
 * finished is handed back, never rendered and charged again.
 *
 * The root is decided once per execution, at pickup, from the execution it
 * continues: that one's own root when it carries one, its continue-from-failed
 * lineage's root, else that execution itself — and it is written on the
 * execution (`workflow_executions.trigger_data.runRoot.executionId`), so the
 * next generation reads it from there, never by walking the chain again. The
 * stamp sits beside the others in `trigger_data` (`appRun`, `appRenderFinal`,
 * `continueFromFailed`); their readers look only at their own keys. Every one
 * of those keys is reserved: a lane that stores caller data in `trigger_data`
 * (a webhook's body, a plugin trigger's event) drops them first
 * (lib/trigger-data-stamps.ts), so a root read here was written by
 * `pinRunRoot`, never posted.
 */
import { serverTriggerData } from "./server-started-runs.js"
import { supabase } from "./supabase.js"

const STAMP_KEY = "runRoot"

/** The `trigger_data` key a continuation's root is written under (reserved: never caller data, lib/trigger-data-stamps.ts). */
export const RUN_ROOT_STAMP_KEY = STAMP_KEY

/** The root a `trigger_data` value carries, or `null` when it carries none. */
export function runRootOf(triggerData: unknown): string | null {
  if (typeof triggerData !== "object" || triggerData === null || Array.isArray(triggerData)) return null
  const stamp = (triggerData as Record<string, unknown>)[STAMP_KEY]
  if (typeof stamp !== "object" || stamp === null || Array.isArray(stamp)) return null
  const id = (stamp as Record<string, unknown>).executionId
  return typeof id === "string" && id.length > 0 ? id : null
}

/**
 * The root of the chain a run continuing `source` belongs to: the root `source`
 * carries, else its continue-from-failed lineage's root, else `source` itself
 * (it is the chain's first run). Pure.
 */
export function continuationRootOf(source: {
  readonly id: string
  readonly runRoot?: string | null
  readonly continueFromFailed?: { readonly root: string } | null
}): string {
  return source.runRoot ?? source.continueFromFailed?.root ?? source.id
}

/**
 * Write `root` on the execution `executionId` (its `trigger_data`, the other
 * stamps kept). Idempotent: a re-picked run writes the same root again.
 * Best-effort: a write that fails leaves the next generation keying by this
 * execution, which renders again what it would have handed back — never
 * another run's clip. Never throws.
 */
export async function pinRunRoot(executionId: string, root: string): Promise<void> {
  try {
    const { data, error } = await supabase.from("workflow_executions").select("trigger_type, trigger_data").eq("id", executionId).maybeSingle()
    if (error) throw new Error(error.message)
    const row = data as { trigger_type?: unknown; trigger_data?: unknown } | null
    const current = row?.trigger_data
    // Already pinned: read like every stamp, only on a run a stamp-writing lane started (lib/server-started-runs.ts).
    if (runRootOf(serverTriggerData(row)) === root) return
    const kept = typeof current === "object" && current !== null && !Array.isArray(current) ? (current as Record<string, unknown>) : {}
    const { error: writeError } = await supabase
      .from("workflow_executions")
      .update({ trigger_data: { ...kept, [STAMP_KEY]: { executionId: root } } })
      .eq("id", executionId)
    if (writeError) throw new Error(writeError.message)
  } catch (err) {
    console.warn(`[continuation] run root not written on ${executionId}:`, err instanceof Error ? err.message : err)
  }
}
