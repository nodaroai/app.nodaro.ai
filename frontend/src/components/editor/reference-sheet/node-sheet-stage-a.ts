import { getCharacter, getObjectById, getLocationById } from "@/lib/api"
import { resolveSheetSections, planSheetGeneration, referenceSheetCreditId } from "@nodaro/shared"
import type { EntityKind, SheetType, SheetFlavour } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { fetchModelCredits } from "@/hooks/use-model-credit-cost"
import { SHEET_TAB_ADAPTERS, SHEET_PANEL_PROVIDER } from "./sheet-tab-adapter"
import { pollJobToCompletion } from "../workflow-editor/poll-job"
import { creditUnitLabel, creditUnits } from "@/lib/credit-units"
import { tx } from "@/lib/i18n"
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

/** The live prices the cost confirm quotes: one panel, and composing the sheet. */
export interface SheetPrices {
  readonly panel: number
  readonly compose: number
}

/** How long the confirm waits for the prices before it asks without them. The
 *  lookup has no timeout of its own, and a stalled one must not stall the run. */
export const SHEET_PRICE_WAIT_MS = 5000

/** Both prices for this sheet, or `undefined` when either is unknown (a build
 *  without credits, a failed lookup, or one still pending after the wait) —
 *  the confirm then quotes no figure. */
async function fetchSheetPrices(flavour: SheetFlavour): Promise<SheetPrices | undefined> {
  let timer: number | undefined
  const waited = new Promise<undefined>((resolve) => { timer = window.setTimeout(resolve, SHEET_PRICE_WAIT_MS) })
  const looked = Promise.all([
    fetchModelCredits(SHEET_PANEL_PROVIDER),
    fetchModelCredits(referenceSheetCreditId(flavour)),
  ])
  const answer = await Promise.race([looked, waited])
  window.clearTimeout(timer)
  if (!answer) return undefined
  const [panel, compose] = answer
  return panel !== undefined && panel > 0 && compose !== undefined && compose > 0 ? { panel, compose } : undefined
}

/** The cost confirm's message: every panel at its live price plus the compose
 *  fee when both are known, the panel count alone otherwise. */
export function sheetPanelsConfirmText(missingCount: number, label: string, prices: SheetPrices | undefined): string {
  const one = missingCount === 1
  if (!prices) return tx(one ? "sheet.confirmPanelsOne" : "sheet.confirmPanels", { label, n: missingCount })
  const panels = missingCount * prices.panel
  return tx(one ? "sheet.confirmPanelsPricedOne" : "sheet.confirmPanelsPriced", {
    label,
    n: missingCount,
    panels: creditUnits(panels),
    compose: creditUnits(prices.compose),
    total: creditUnits(panels + prices.compose),
    u: creditUnitLabel(tx("credits.unitShort")),
  })
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

  const prices = args.confirm ? undefined : await fetchSheetPrices(flavour)
  const confirm = args.confirm ?? ((n, l) => window.confirm(sheetPanelsConfirmText(n, l, prices)))
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
