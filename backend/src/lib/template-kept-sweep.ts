/**
 * A deleted template's kept example run (design: UGC templates with data): the copies under
 * `templates/<id>/kept/` of a template switched off (`is_active = false`) at least 30 days ago are
 * deleted. While the template exists its copies stay — earlier clones show them — and there is no
 * claw-back from a clone: once the copies go, a clone's example nodes show nothing.
 *
 * The age is the row's own `updated_at` (an admin edit restarts the clock: the safe direction). A
 * template is looked at while it is between 30 and 90 days off, so the daily run lists each one a
 * bounded number of times; a key storage fails to delete is recorded by the funnel
 * (`deleteKeysRecordingFailures`) and retried by the daily retry pass. Best-effort: a failure is
 * counted and reported, never thrown. Every edition runs it; where no template ever kept a run, a run
 * is one query.
 */
import { supabase } from "./supabase.js"
import { isStorageConfigured, listObjectsByPrefixWithMeta } from "./storage.js"
import { deleteKeysRecordingFailures } from "./storage-delete.js"
import { templateKeptPrefix } from "./template-preview-key.js"

const DAY_MS = 24 * 60 * 60 * 1000
export const TEMPLATE_KEPT_GRACE_MS = 30 * DAY_MS
/** How long after the grace a switched-off template is still looked at. */
export const TEMPLATE_KEPT_WINDOW_MS = 60 * DAY_MS
const BATCH = 200
const SWEEP_INTERVAL_MS = DAY_MS

export interface TemplateKeptSweepResult {
  readonly templates: number
  readonly deleted: number
  readonly failed: number
}

export async function sweepDeletedTemplateKeptCopies(nowMs: number = Date.now()): Promise<TemplateKeptSweepResult> {
  const before = new Date(nowMs - TEMPLATE_KEPT_GRACE_MS).toISOString()
  const after = new Date(nowMs - TEMPLATE_KEPT_GRACE_MS - TEMPLATE_KEPT_WINDOW_MS).toISOString()
  const { data, error } = await supabase
    // tenant-scope-ignore: a platform sweep over switched-off templates' own storage, no user scope.
    .from("workflow_templates")
    .select("id")
    .eq("is_active", false)
    .lt("updated_at", before)
    .gt("updated_at", after)
    .limit(BATCH)
  if (error) return { templates: 0, deleted: 0, failed: 1 }
  let deleted = 0
  let failed = 0
  const rows = (data ?? []) as Array<{ id?: unknown }>
  for (const row of rows) {
    if (typeof row.id !== "string" || row.id === "") continue
    const prefix = templateKeptPrefix(row.id)
    try {
      // Listed BY the prefix, re-asserted anyway: this is the last check before a delete.
      const keys = (await listObjectsByPrefixWithMeta(prefix)).map((o) => o.key).filter((key) => key.startsWith(prefix))
      if (keys.length === 0) continue
      const result = await deleteKeysRecordingFailures(keys, "template-kept")
      deleted += result.deleted
      failed += result.failed.length
    } catch {
      failed++
    }
  }
  return { templates: rows.length, deleted, failed }
}

/** Sweep on boot, then once a day. Returns the stop function the server's `onClose` awaits. */
export function startTemplateKeptSweep(report: (message: string) => void): () => Promise<void> {
  if (!isStorageConfigured()) return async () => {}
  let stopped = false
  let pending: Promise<void> | undefined
  const tick = () => {
    if (stopped || pending) return
    pending = (async () => {
      const result = await sweepDeletedTemplateKeptCopies()
      if (result.failed > 0) report(`Deleted templates' kept runs: ${result.failed} failed; they will be retried`)
    })().finally(() => {
      pending = undefined
    })
  }
  const timer = setInterval(tick, SWEEP_INTERVAL_MS)
  timer.unref()
  tick()
  return async () => {
    stopped = true
    clearInterval(timer)
    await pending
  }
}
