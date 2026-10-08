/**
 * How the editor reviews each render node (C3.4, SV18): the renders a Run would
 * make, the render's own rule, the settings basis its takes are stamped with,
 * whether Render final can run at all, and how a fresh take's clock maps back
 * to the master clock. One table keyed by the render-node registry
 * (`RENDER_NODE_TYPES`), so the review inspector, the node face, the context
 * menu and Render final ask the anchored render's own questions — never Apply
 * EDL's of a Speaker View. `__tests__/render-review-adapter.test.ts` fails a
 * registry id with no entry here.
 *
 *  - Apply EDL: its renders, rule and basis as before (`resolveApplyEdlRenders`,
 *    `applyEdlRendersValidity`, `renderSettingsBasisOf`); the clock maps through
 *    the EDL on its wire (`clockMapFrom: "input"`).
 *  - Speaker View: each render reads its `edl` and `transcript` wires on its
 *    row; its rule is the plugin's, mirrored (`findSpeakerViewIssues`); its
 *    basis is the one its run sends (`speakerViewRenderBasis` over the settings
 *    normalized against the real edit); its clock maps through the EDL the take
 *    itself emitted on `json` (`clockMapFrom: "output-json"`: turns split,
 *    layouts written). It cannot run while it has no price (C4).
 */
import { editPlanBasis, normalizeEdl, planFanOut, renderNodeOf, withWiredSettings, type Edl, type SavedRenderItem } from "@nodaro/shared"
import {
  SPEAKER_VIEW_PRICED,
  buildEffectiveEdl,
  findSpeakerViewIssues,
  speakerViewContext,
  speakerViewRenderBasis,
  speakerViewWireSettings,
  type SpeakerViewNodeSettings,
} from "@nodaro/render-rules"
import { getListFanOutForNode, resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import { applyEdlRenderSettings, resolveApplyEdlRenders } from "@/lib/apply-edl-render-input"
import { applyEdlRendersValidity, type ApplyEdlRenderInput, type EdlValidity } from "@/lib/edl-validity"
import { speakerViewRowsValidity } from "@/lib/speaker-view-validity"
import { clockMapOf } from "@/lib/edl-review/review-clock"
import { renderSettingsBasisOf } from "@/lib/edl-review/staleness"
import type { ReviewRenderContext } from "@/lib/edl-review/restore"
import type { MessageKey } from "@/lib/i18n/en"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/** One render a Run of a render node makes: its row, the EDL and Sources media
 *  it reads, and (Speaker View) the transcript on its row. */
export interface RenderRow extends ApplyEdlRenderInput {
  readonly transcript?: unknown
}

type Data = Readonly<Record<string, unknown>>
type Nodes = readonly WorkflowNode[]
type Edges = readonly WorkflowEdge[]

/** What a finished render job stored of its request (`GET /v1/jobs/:id`). */
export type StoredRequest = Readonly<Record<string, unknown>>

export interface RenderReviewAdapter {
  /** Every render a Run of the node makes now, in run order. */
  readonly rows: (node: WorkflowNode, nodes: Nodes, edges: Edges) => RenderRow[]
  /** The render's own rule on those renders; null with nothing to judge. */
  readonly validity: (rows: readonly RenderRow[], data: Data) => EdlValidity | null
  /** The settings basis the run of `row` stamps on its take (`renderBasis`). */
  readonly settingsBasis: (row: RenderRow | undefined, data: Data) => string | undefined
  /** The render settings a review's restore checks read. */
  readonly reviewContext: (data: Data, sources: readonly string[]) => ReviewRenderContext
  /** Why no run of this render can go ahead at all; undefined when one can. */
  readonly runRefusal: (data: Data) => MessageKey | undefined
  /** Would the final of `row` send exactly what `stored` was made from? Absent:
   *  unknowable, so it answers "changed" (TA15 a fails open). */
  readonly sameAsStoredFinal?: (row: RenderRow, data: Data, stored: StoredRequest) => boolean
}

const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v
  try { return JSON.parse(v) } catch { return undefined }
}

const isBlank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && !v.trim())

/** The key-order-free fingerprint of a value (the shared canonical hash). */
const sameValue = (a: unknown, b: unknown): boolean => editPlanBasis(a) === editPlanBasis(b)

const applyEdl: RenderReviewAdapter = {
  rows: (node, nodes, edges) => resolveApplyEdlRenders(node, nodes, edges),
  validity: (rows, data) => applyEdlRendersValidity(rows, applyEdlRenderSettings(data)),
  settingsBasis: (row, data) => renderSettingsBasisOf(row, applyEdlRenderSettings(data)),
  reviewContext: (data, sources) => ({ ...applyEdlRenderSettings(data), sources }),
  runRefusal: () => undefined,
  sameAsStoredFinal: (row, data, stored) => {
    const settings = applyEdlRenderSettings(data)
    const raw = typeof row.edl === "string" ? JSON.parse(row.edl) : row.edl
    const effective = buildEffectiveEdl(raw, { crossfadeMs: settings.crossfadeMs, sourceOverrides: row.sources })
    return sameValue(stored.edl, effective) && (stored.output === "audio" ? "audio" : "video") === settings.output
  },
}

/** A Speaker View render's settings as its run sends them, and the edit its
 *  rule accepted; undefined when the rule refuses (nothing would be stamped). */
function speakerViewRun(row: RenderRow | undefined, data: Data) {
  if (!row || isBlank(row.edl)) return undefined
  const edl = parse(row.edl)
  const transcript = isBlank(row.transcript) ? undefined : parse(row.transcript)
  const settings = speakerViewWireSettings(data as SpeakerViewNodeSettings, speakerViewContext(edl, transcript))
  const verdict = findSpeakerViewIssues({ edl, transcript, settings })
  return verdict.ok && verdict.edl ? { settings, edl: verdict.edl } : undefined
}

const speakerView: RenderReviewAdapter = {
  // The engine's own plan, as for Apply EDL: one render per row it runs, each
  // reading what `resolveNodeInputs` resolves on its row.
  rows: (node, nodes, edges) => {
    const ns = nodes as WorkflowNode[]
    const es = edges as WorkflowEdge[]
    const plan = planFanOut(getListFanOutForNode(node, ns, es), node.type ?? "", withWiredSettings(node, ns, es).data as Record<string, unknown>)
    const data = node.data as Data
    return (plan ? plan.rows : [undefined]).map((row) => {
      const inputs = resolveNodeInputs(node, ns, es, row)
      const transcript = inputs.transcript ?? data.transcript
      return {
        ...(row !== undefined ? { row } : {}),
        edl: inputs.edl ?? data.edl,
        sources: [],
        ...(transcript !== undefined ? { transcript } : {}),
      }
    })
  },
  validity: (rows, data) => speakerViewRowsValidity(rows, data),
  settingsBasis: (row, data) => {
    const run = speakerViewRun(row, data)
    return run ? speakerViewRenderBasis(run.settings, run.edl) : undefined
  },
  // Video only, no node-level crossfade and no Sources wire.
  reviewContext: () => ({ output: "video", crossfadeMs: 0, sources: [] }),
  runRefusal: () => (SPEAKER_VIEW_PRICED ? undefined : "speakerView.notPriced"),
}

/** Every render node type's adapter, keyed by the registry's ids. */
export const RENDER_REVIEW_ADAPTERS: Readonly<Record<string, RenderReviewAdapter>> = Object.freeze({
  "apply-edl": applyEdl,
  "speaker-view": speakerView,
})

/** The adapter of a render node type; undefined for any other type. */
export function renderReviewAdapterOf(type: unknown): RenderReviewAdapter | undefined {
  return renderNodeOf(type) && Object.hasOwn(RENDER_REVIEW_ADAPTERS, type as string) ? RENDER_REVIEW_ADAPTERS[type as string] : undefined
}

/** Why Render final / Update preview cannot run on this node; undefined when they can. */
export function renderRunRefusalKey(node: Pick<WorkflowNode, "type" | "data"> | undefined): MessageKey | undefined {
  return node ? renderReviewAdapterOf(node.type)?.runRefusal((node.data ?? {}) as Data) : undefined
}

/** Every render a Run of `node` makes now (none for a node that is not a render). */
export function renderRowsOf(node: WorkflowNode, nodes: Nodes, edges: Edges): RenderRow[] {
  return renderReviewAdapterOf(node.type)?.rows(node, nodes, edges) ?? []
}

/** The settings basis the run of `row` stamps on its take. */
export function renderSettingsBasisFor(node: Pick<WorkflowNode, "type" | "data">, row: RenderRow | undefined): string | undefined {
  return renderReviewAdapterOf(node.type)?.settingsBasis(row, (node.data ?? {}) as Data)
}

/** The output EDL a take emitted, when the node's saved `json` is that take's:
 *  the newest take's run wrote it (`generatedJson`), so any other take has no
 *  map. Null when there is none, or it is not one EDL. */
function emittedClockOf(renderData: Data, take: SavedRenderItem | undefined): Edl | null {
  if (!take) return null
  const results = Array.isArray(renderData.generatedResults) ? (renderData.generatedResults as Array<{ url?: unknown }>) : []
  const newest = typeof results[0]?.url === "string" ? results[0].url : renderData.generatedVideoUrl
  if (newest !== take.url) return null
  const raw = parse(renderData.generatedJson)
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  try {
    return normalizeEdl(raw)
  } catch {
    return null
  }
}

export interface TakeClockInput {
  readonly type: unknown
  readonly renderData: Data
  /** The fresh take the map is for. */
  readonly take: SavedRenderItem | undefined
  /** The render's first row (the EDL on its wire now). */
  readonly row: RenderRow | undefined
  readonly context: ReviewRenderContext
  /** The render reads its plan through another node (Camera Switch). */
  readonly passesOtherNodes: boolean
}

/**
 * The clock map of a FRESH take, by the registry's `clockMapFrom`:
 *  - `input`: the effective EDL on the render's wire. Behind Camera Switch it
 *    is null: the take records no run it shares with the switch's saved output.
 *  - `output-json`: the EDL the take itself emitted, which IS what it drew,
 *    wherever its plan came from; null for a take whose json is not on the node.
 */
export function takeClockMap(input: TakeClockInput): Edl | null {
  const from = renderNodeOf(input.type)?.clockMapFrom
  if (from === "output-json") return emittedClockOf(input.renderData, input.take)
  if (from === "input") return input.passesOtherNodes ? null : clockMapOf(input.row?.edl, input.context)
  return null
}
