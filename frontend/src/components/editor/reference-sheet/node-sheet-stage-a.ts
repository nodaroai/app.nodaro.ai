import { getCharacter, getObjectById, getLocationById } from "@/lib/api"
import { resolveSheetSections, planSheetGeneration } from "@nodaro/shared"
import type { EntityKind, SheetType, SheetFlavour } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { SHEET_TAB_ADAPTERS } from "./sheet-tab-adapter"
import { pollJobToCompletion } from "../workflow-editor/poll-job"
import { WorkflowStaleError, type ExecutionContext } from "../workflow-editor/types"

/**
 * Stage A for the canvas Reference Sheet node.
 *
 * The node is a one-click "make a reference sheet": given a connected entity
 * with a main image, generate the panels the chosen sheet `type` needs but the
 * entity doesn't have yet (turnarounds, expressions, materials, …) off that
 * main image, so Stage B can compose a full sheet — not a header-only card.
 * This mirrors the Studio "Sheet" tab's Stage A, driven headless from the DAG
 * executor with node-card progress and a cost confirm (each panel is charged,
 * so we never generate silently).
 *
 * - Reuses panels the entity already has (`planSheetGeneration`); generates only
 *   the missing ones, bounded-parallel, tolerating individual panel failures
 *   (compose then proceeds with whatever landed — empty bands are skipped by the
 *   backend `buildResolvedSections`).
 * - No-op when nothing is missing (straight to compose).
 * - Throws `SHEET_STAGE_A_CANCELLED` if the user declines the confirm or aborts.
 */

/** Thrown when the user declines the cost confirm, or the run is aborted. The
 *  caller unwinds quietly (no failure painted on the node). */
export const SHEET_STAGE_A_CANCELLED = "sheet-stage-a-cancelled"

/** Max panels generated concurrently (mirrors the AI-writer fan-out cap + spec
 *  §15 "bounded parallel" — keeps the per-panel credit guard from being slammed). */
const SHEET_PANEL_CONCURRENCY = 3

// Per-entity GET shapes differ; only camelCase bucket fields + name +
// sourceImageUrl are read, all of which the three GETs return.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EntityRow = Record<string, any>

async function fetchSheetEntity(kind: EntityKind, dbId: string): Promise<EntityRow> {
  const row =
    kind === "character" ? await getCharacter(dbId)
    : kind === "object" ? await getObjectById(dbId)
    : await getLocationById(dbId)
  if (!row) throw new Error("entity_not_found")
  return row as EntityRow
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

function defaultConfirm(missingCount: number, label: string): boolean {
  const n = missingCount
  return window.confirm(
    `"${label}": this reference sheet needs ${n} more panel${n === 1 ? "" : "s"} generated from the ` +
      `main image (each is charged separately, then composing adds the assembly fee). ` +
      `Generate ${n} panel${n === 1 ? "" : "s"} now?`,
  )
}

export async function ensureNodeSheetPanels(args: {
  entityKind: EntityKind
  entityDbId: string
  type: SheetType
  flavour: SheetFlavour
  ctx: ExecutionContext
  nodeId: string
  label: string
  /** Override the cost confirm (tests). Return false to cancel. */
  confirm?: (missingCount: number, label: string) => boolean
}): Promise<void> {
  const { entityKind, entityDbId, type, flavour, ctx, nodeId, label } = args
  const { updateNodeData } = useWorkflowStore.getState()

  const entity = await fetchSheetEntity(entityKind, entityDbId)
  const name: string = (entity.name as string) || "Subject"
  const sourceImageUrl: string | undefined = (entity.sourceImageUrl as string | null) ?? undefined

  const sections = resolveSheetSections(entityKind, type, flavour.sections)
  const buckets = SHEET_TAB_ADAPTERS[entityKind].bucketsByColumn(entity)
  const { missing } = planSheetGeneration(entityKind, sections, flavour, buckets, name)

  if (missing.length === 0) return // every panel already exists — straight to compose

  // Panels are generated off the main image; without one there's nothing to do.
  if (!sourceImageUrl) {
    throw new Error(`Approve a main image for the connected ${entityKind} before generating its sheet`)
  }

  const confirm = args.confirm ?? defaultConfirm
  if (!confirm(missing.length, label)) throw new Error(SHEET_STAGE_A_CANCELLED)
  if (ctx.signal?.aborted) throw new Error(SHEET_STAGE_A_CANCELLED)

  updateNodeData(nodeId, { executionStatus: "running", currentJobId: undefined, currentJobProgress: 0 })

  let done = 0
  const generateAsset = SHEET_TAB_ADAPTERS[entityKind].generateAsset
  await runBounded(missing, SHEET_PANEL_CONCURRENCY, async (req) => {
    if (ctx.signal?.aborted) throw new Error(SHEET_STAGE_A_CANCELLED)
    try {
      const { jobId } = await generateAsset(entityDbId, {
        assetType: req.assetType,
        variant: req.variant,
        attachToColumn: req.attachToColumn,
        attachName: req.attachName,
        userPrompt: req.userPrompt,
        name: `${name} – ${req.variant}`,
        sourceImageUrl,
      })
      await pollJobToCompletion(jobId, ctx)
    } catch (e) {
      // Tolerate ONE panel failing — compose proceeds with whatever landed. But
      // STOP the whole batch on an abort or a workflow switch: don't keep
      // generating + charging panels for a run the user has cancelled or left.
      if (e instanceof WorkflowStaleError) throw e
      if (e instanceof Error && e.message === SHEET_STAGE_A_CANCELLED) throw e
    } finally {
      done += 1
      updateNodeData(nodeId, { currentJobProgress: Math.round((done / missing.length) * 100) })
    }
  })
}
