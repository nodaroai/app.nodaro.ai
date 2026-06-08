import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { resolveSheetSections, planSheetGeneration } from "@nodaro/shared"
import type { EntityKind, SheetType, SheetFlavour } from "@nodaro/shared"
import { resolveSheetEntity } from "./payload-builder.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState, OrchestratorContext } from "./types.js"

/**
 * Reference Sheet — Stage A for the WORKFLOW-RUN path.
 *
 * The frontend single-node Run generates the panels a sheet type needs but the
 * entity lacks (turnarounds/expressions/…) before composing (see
 * `frontend/.../reference-sheet/node-sheet-stage-a.ts`). The backend orchestrator
 * is otherwise compose-only, so a sheet node inside an automated workflow would
 * only assemble pre-existing panels. This runs the equivalent Stage A headless:
 * plan the missing panels, generate each via the existing `generate-*-asset`
 * route (internal HTTP — same mechanism the sync-HTTP nodes use; the route
 * reserves per-panel credits and the worker attaches the panel to the entity's
 * bucket), then let the normal compose job (`executeWorkerNode`) assemble them.
 *
 * - Reuses panels the entity already has (`planSheetGeneration`); generates only
 *   the missing ones, bounded-parallel, tolerating individual panel failures
 *   (compose proceeds with whatever landed; the worker's `no_panels` guard +
 *   refund covers a total failure).
 * - No-op when nothing is missing, when no entity is wired (the compose job's
 *   `entity_not_ready` guard handles that), or when the row can't be loaded.
 * - Throws `main_image_required` when panels are needed but the entity has no
 *   establishing image — failing the node BEFORE the compose job reserves the
 *   assembly fee.
 *
 * Workflow runs can't prompt, so there is no cost confirm here (unlike the
 * node's single-node Run). The per-panel credit charges are the same as the
 * Studio / single-node paths.
 */

const TABLE: Record<EntityKind, string> = { character: "characters", object: "objects", location: "locations" }

const ROUTE: Record<EntityKind, { path: string; attachField: string }> = {
  character: { path: "/v1/generate-character-asset", attachField: "attachToCharacterId" },
  object: { path: "/v1/generate-object-asset", attachField: "attachToObjectId" },
  location: { path: "/v1/generate-location-asset", attachField: "attachToLocationId" },
}

/** Generated concurrently at most this many at once (mirrors the frontend
 *  SHEET_PANEL_CONCURRENCY + spec §15 "bounded parallel"). */
const STAGE_A_CONCURRENCY = 3
/** Per-panel ceiling so one stuck generation can't hold the whole node. */
const PANEL_TIMEOUT_MS = 8 * 60 * 1000
const PANEL_POLL_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function runBounded<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const worker = async () => {
    for (;;) {
      const item = queue.shift()
      if (item === undefined) return
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker))
}

/** POST a single panel to its `generate-*-asset` route (internal-secret auth,
 *  same as executeSyncHttpNode). Returns the created jobId, or undefined when
 *  the route rejected (logged + tolerated by the caller). */
async function postGenerateAsset(
  entityKind: EntityKind,
  entityDbId: string,
  ctx: OrchestratorContext,
  req: { assetType: string; variant: string; attachToColumn: string; attachName: string; userPrompt?: string; name: string; sourceImageUrl: string },
): Promise<string | undefined> {
  const { path, attachField } = ROUTE[entityKind]
  const port = process.env.BACKEND_PORT || process.env.PORT || "8000"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Internal-Orchestrator-Secret": config.INTERNAL_ORCHESTRATOR_SECRET,
  }
  if (ctx.isAppRun) headers["X-App-Run"] = "true"
  const body: Record<string, unknown> = {
    userId: ctx.userId,
    assetType: req.assetType,
    variant: req.variant,
    name: req.name,
    userPrompt: req.userPrompt,
    sourceImageUrl: req.sourceImageUrl,
    attachToColumn: req.attachToColumn,
    attachName: req.attachName,
    [attachField]: entityDbId,
  }
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PANEL_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    console.warn(`[orchestrator] reference-sheet Stage-A panel route ${path} rejected (${res.status}): ${text.slice(0, 200)}`)
    return undefined
  }
  const result = (await res.json()) as { jobId?: string }
  return result.jobId
}

/** Poll a panel's job row until terminal. Resolves on completed; throws on
 *  failed/cancelled/timeout (the caller tolerates it). */
async function pollPanelJob(jobId: string): Promise<void> {
  const deadline = Date.now() + PANEL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(PANEL_POLL_MS)
    const { data } = await supabase.from("jobs").select("status").eq("id", jobId).single()
    const status = data?.status as string | undefined
    if (status === "completed") return
    if (status === "failed" || status === "cancelled") throw new Error(`panel ${status}`)
  }
  throw new Error("panel generation timed out")
}

export async function ensureWorkflowSheetPanels(
  node: SimpleNode,
  ctx: OrchestratorContext,
  graph: { nodes?: SimpleNode[]; edges?: SimpleEdge[]; nodeStates?: Record<string, NodeExecutionState> },
): Promise<void> {
  const data = node.data as { type?: SheetType; flavour?: SheetFlavour }
  const flavour = data.flavour
  if (!flavour || !data.type) return // malformed config — the compose job's validation handles it

  const { entityKind, entityDbId } = resolveSheetEntity(node.id, graph)
  // No wired/saved entity → the compose job's payload-builder throws
  // entity_not_ready (before reserving), so don't duplicate that here.
  if (!entityKind || !entityDbId) return

  const { data: row } = await supabase
    .from(TABLE[entityKind])
    .select("*")
    .eq("id", entityDbId)
    .eq("user_id", ctx.userId)
    .is("deleted_at", null)
    .single()
  if (!row) return // compose job re-fetch will surface the not-found

  const sections = resolveSheetSections(entityKind, data.type, flavour.sections)
  const name = (row.name as string) || "Subject"
  const { missing } = planSheetGeneration(
    entityKind,
    sections,
    flavour,
    row as Record<string, ReadonlyArray<{ name?: string; url?: string }> | undefined>,
    name,
  )
  if (missing.length === 0) return // every panel already exists — compose finds them

  const sourceImageUrl = (row.source_image_url as string | null) ?? undefined
  if (!sourceImageUrl) {
    // Panels are image-to-image off the establishing shot; without one we can't
    // generate. Fail the node here, before the compose job reserves the fee.
    throw new Error("main_image_required")
  }

  await runBounded(missing, STAGE_A_CONCURRENCY, async (req) => {
    // Stop generating more panels once the execution is cancelled (in-flight
    // panels finish; no new ones start — mirrors the frontend's signal check).
    if (ctx.cancelled) return
    try {
      const jobId = await postGenerateAsset(entityKind, entityDbId, ctx, {
        assetType: req.assetType,
        variant: req.variant,
        attachToColumn: req.attachToColumn,
        attachName: req.attachName,
        userPrompt: req.userPrompt,
        name: `${name} – ${req.variant}`,
        sourceImageUrl,
      })
      if (jobId) await pollPanelJob(jobId)
    } catch (err) {
      // Tolerate one panel failing — compose proceeds with whatever landed; the
      // worker's no_panels guard + refund covers a total failure.
      console.warn(
        `[orchestrator] reference-sheet Stage-A panel "${req.variant}" failed:`,
        err instanceof Error ? err.message : err,
      )
    }
  })
}
