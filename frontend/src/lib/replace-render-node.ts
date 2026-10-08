/**
 * Swap one render node for another in place (SV16 b, decided 2026-10-06; its
 * outgoing edges, option iii, decided 2026-10-08) — "Replace with Speaker
 * View" on an Apply EDL that meets a hinted edit, and on Camera Switch's
 * layout-hints note. Pure: the graph in, the next graph out; the hook
 * (`hooks/use-replace-render-node.ts`) applies it as ONE undo step.
 *
 * Everything is read from the render-node registry (`@nodaro/shared`
 * render-nodes.ts) and the node definitions, never from a list of node types,
 * so the swap works in both directions and for any render that joins:
 *
 *  - The new node has a new id (its run history is on the old node's clock and
 *    is not carried; Undo restores the old node with it), the old node's place,
 *    and only its `label` and `quality` — the label only when someone chose
 *    it, never the old type's default name.
 *  - An input wire is kept when the new type takes that input (`edl`,
 *    `transcript`); any other (`sources`) is dropped and listed.
 *  - The remapped transcript moves with its wire: from where the old render
 *    emits it to where the new one does (Apply EDL's `json` ↔ Speaker View's
 *    `transcript`), so a caption step keeps its words — nothing dropped, nothing
 *    transcribed again. The media wire moves to the new media pip. A `json` wire
 *    lands on the new `json` only when both carry the same kind; otherwise
 *    (Speaker View's EDL going back to an Apply EDL, whose `json` is a
 *    transcript) it is dropped and listed.
 *  - A downstream node that names the old node by id (an order list, a field
 *    mapping, a List column) is renamed with it. A node whose every wire from
 *    the old node was dropped loses its field mappings to it, as deleting
 *    those wires does — a mapping with no wire must not quietly read the new
 *    node's media.
 *  - An EDL or transcript typed into the node (an inline value of an input
 *    both types take) carries over, both ways — as text, the form every render
 *    reads an inline value in, as it reads a wire (Round 2, decided 2026-10-08).
 *  - The published app follows the node: its own app flags come with it, and
 *    the app's items, card and settings that name the old id are re-pointed to
 *    the new one (`lib/presentation-node-id.ts`; Undo brings them back).
 *  - Refused before anything changes: a render of a medium the new type cannot
 *    make (an audio-only Apply EDL), and an edit whose cameras come from a wire
 *    the swap would drop (TA1). When the edit is not known yet (Camera Switch
 *    has not run, or the wired upload is empty), TA1 cannot be judged: the swap
 *    is allowed and the plan says the cameras may need re-wiring (Round 2).
 */
import { RENDER_JSON_HANDLE, renderNodeOf, renderTranscriptOutputOf } from "@nodaro/shared"
import { buildEffectiveEdl, findEffectiveEdlIssues } from "@nodaro/render-rules"
import { NODE_DEFINITIONS, type WorkflowEdge, type WorkflowNode } from "@/types/nodes"
import { resolveApplyEdlRenders, applyEdlRenderSettings } from "@/lib/apply-edl-render-input"
import type { ApplyEdlRenderInput, ApplyEdlRenderSettings } from "@/lib/edl-validity"
import { appItemsNaming, renameNodeId, type AppItemNaming } from "@/lib/presentation-node-id"
import type { PresentationItem } from "@nodaro/shared"

/** The render a hinted edit is handed to (SV16): the one that draws layouts. */
export const SPEAKER_VIEW_TYPE = "speaker-view"

export type RenderSwapRefusal =
  /** The node, or the type asked for, is not a render. */
  | "not-a-render"
  | "same-type"
  /** The node renders a medium the new type cannot (an audio-only Apply EDL). */
  | "medium"
  /** The edit's cameras come from a wire the swap would drop (TA1). */
  | "cameras-from-sources"
  /** A render type without exactly one media output (a registry mistake). */
  | "no-media-output"

/** One wire of the node being replaced. */
export interface RenderSwapWire {
  readonly edgeId: string
  readonly direction: "in" | "out"
  /** Its handle on the replaced node. */
  readonly handle: string
  /** The node at its other end. */
  readonly nodeId: string
}

/** An app item that names the node, and whether the new type can show it (an
 *  output or field the new type does not expose is re-pointed but shows
 *  nothing until it is swapped back). */
export type RenderSwapAppItem = AppItemNaming & { readonly shown: boolean }

/** The published app's settings, as far as the swap reads and re-points them. */
export type RenderSwapPresentation = {
  readonly inputItems?: readonly PresentationItem[]
  readonly outputItems?: readonly PresentationItem[]
}

export interface RenderSwapPlan {
  readonly ok: true
  /** Input wires kept as they are, on the new node. */
  readonly kept: readonly RenderSwapWire[]
  /** Output wires moved onto the new node, each with the handle it lands on. */
  readonly moved: readonly (RenderSwapWire & { readonly to: string })[]
  /** Wires the new node has no place for. */
  readonly dropped: readonly RenderSwapWire[]
  /** A dropped input wire may be where the edit's cameras come from, and the
   *  edit is not known yet to tell (Round 2, decided 2026-10-08). */
  readonly camerasUnjudged: boolean
  /** The inputs typed into the node (inline values) that carry over. */
  readonly inline: readonly string[]
  /** The published app's items that name the node, re-pointed to the new one. */
  readonly appItems: readonly RenderSwapAppItem[]
}

export type RenderSwapCheck = RenderSwapPlan | { readonly ok: false; readonly reason: RenderSwapRefusal }

export type RenderSwapResult =
  | {
      readonly ok: true
      readonly nodes: WorkflowNode[]
      readonly edges: WorkflowEdge[]
      readonly plan: RenderSwapPlan
      /** The app's settings re-pointed (the same object when none named the
       *  node); absent when none were given. */
      readonly presentationSettings?: RenderSwapPresentation
    }
  | { readonly ok: false; readonly reason: RenderSwapRefusal }

const definitionOf = (type: string) => NODE_DEFINITIONS.find((d) => d.type === type)

/** The name a node of `type` is created with — not a name anyone chose, so a
 *  swap does not carry it (an Apply EDL nobody renamed must not become a
 *  Speaker View headed "Apply EDL", left untranslated by the label tables). */
const defaultLabelOf = (type: string | undefined): unknown =>
  type ? (definitionOf(type)?.defaultData as { label?: unknown } | undefined)?.label : undefined

/** A render's one media output pip: the output that is not one of its data
 *  pips (its `json`, its transcript). `undefined` unless there is exactly one. */
export function renderMediaHandleOf(type: string): string | undefined {
  const d = renderNodeOf(type)
  const outputs = definitionOf(type)?.outputs ?? []
  if (!d) return undefined
  const json = RENDER_JSON_HANDLE
  const media = outputs.filter((h) => h !== json && h !== d.transcriptOutput.handle)
  return media.length === 1 ? media[0] : undefined
}

const parsed = (edl: unknown): unknown => {
  if (typeof edl !== "string") return edl
  try {
    return JSON.parse(edl)
  } catch {
    return undefined
  }
}

const isEdlObject = (v: unknown): boolean => !!v && typeof v === "object" && !Array.isArray(v)

/** The ids of the sources the render rule finds with no url. */
function missingUrlSources(edl: unknown, settings: ApplyEdlRenderSettings, overrides: readonly string[]): Set<string> {
  const effective = buildEffectiveEdl(edl, { crossfadeMs: settings.crossfadeMs, sourceOverrides: overrides })
  const ids = new Set<string>()
  for (const issue of findEffectiveEdlIssues(effective, settings.output)) {
    if (issue.code === "missing-url") ids.add(issue.sourceId)
  }
  return ids
}

/** TA1: does any render read a camera whose url only its `sources` wire gives? */
function camerasFromSources(renders: readonly ApplyEdlRenderInput[], settings: ApplyEdlRenderSettings): boolean {
  return renders.some((r) => {
    if (r.sources.length === 0) return false
    const edl = parsed(r.edl)
    if (!isEdlObject(edl)) return false
    const withWire = missingUrlSources(edl, settings, r.sources)
    for (const id of missingUrlSources(edl, settings, [])) if (!withWire.has(id)) return true
    return false
  })
}

/** The edit cannot be judged yet for TA1: a render has no EDL to read, or the
 *  wire delivers no media while the edit leaves a camera's url to it. */
function camerasUnknown(renders: readonly ApplyEdlRenderInput[], settings: ApplyEdlRenderSettings): boolean {
  if (renders.length === 0) return true
  return renders.some((r) => {
    const edl = parsed(r.edl)
    if (!isEdlObject(edl)) return true
    return r.sources.length === 0 && missingUrlSources(edl, settings, []).size > 0
  })
}

/** The inputs both types take that hold a value typed into the node. */
function inlineInputs(data: Record<string, unknown>, from: string, to: string): string[] {
  const toInputs = new Set(definitionOf(to)?.inputs ?? [])
  return (definitionOf(from)?.inputs ?? []).filter((h) => toInputs.has(h) && data[h] !== undefined && data[h] !== null && data[h] !== "")
}

/** An inline value as text: as a render reads a wire, and as both renders
 *  read their inline values (Apply EDL's transcript only as text). */
const asText = (v: unknown): unknown => (typeof v === "string" ? v : JSON.stringify(v))

/** The node's app items and whether `toType` can show each. A section with no
 *  item list yet shows the node by its own flag (`presentationInput/Output`). */
function appItemsOf(node: WorkflowNode, toType: string, presentation: RenderSwapPresentation | undefined): RenderSwapAppItem[] {
  const data = (node.data ?? {}) as Record<string, unknown>
  const d = definitionOf(toType)
  const fields = new Set((d?.exposableFields ?? []).map((f) => f.key))
  const outputs = new Set((d?.exposableOutputs ?? []).map((o) => o.key))
  const shown = (i: AppItemNaming): boolean =>
    i.kind === "node" || (i.kind === "field" ? fields.has(i.key ?? "") : outputs.has(i.key ?? ""))
  const items: AppItemNaming[] = appItemsNaming(presentation, node.id)
  if (!presentation?.inputItems && data.presentationInput === true) items.unshift({ section: "input", kind: "node" })
  if (!presentation?.outputItems && data.presentationOutput === true) items.push({ section: "output", kind: "node" })
  return items.map((i) => ({ ...i, shown: shown(i) }))
}

/**
 * U6's trigger: does any render of this Apply EDL read an edit its render rule
 * refuses for a Speaker View feature — a layout or a region crop?
 */
export function rendersNeedingSpeakerView(
  renders: readonly ApplyEdlRenderInput[],
  settings: ApplyEdlRenderSettings,
): boolean {
  return renders.some((r) => {
    const edl = parsed(r.edl)
    if (!isEdlObject(edl)) return false
    const effective = buildEffectiveEdl(edl, { crossfadeMs: settings.crossfadeMs, sourceOverrides: r.sources })
    return findEffectiveEdlIssues(effective, settings.output).some((i) => i.code === "layout" || i.code === "region")
  })
}

/** Where an output wire of `from` lands on `to`, or `null` when it has no place. */
function outputHandleOn(from: string, to: string, handle: string | null | undefined): string | null {
  const fromD = renderNodeOf(from)!
  const toD = renderNodeOf(to)!
  if (handle === fromD.transcriptOutput.handle) return toD.transcriptOutput.handle
  if (handle === RENDER_JSON_HANDLE) return fromD.jsonKind === toD.jsonKind ? RENDER_JSON_HANDLE : null
  // Every other pip of a render, the default (no handle) included, is its media.
  return renderMediaHandleOf(to) ?? null
}

/** Check a swap of node `nodeId` to `toType`, and say what it would do. */
export function planRenderSwap(
  nodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  toType: string,
  presentation?: RenderSwapPresentation,
): RenderSwapCheck {
  const node = nodes.find((n) => n.id === nodeId)
  const from = node?.type
  const fromD = renderNodeOf(from)
  const toD = renderNodeOf(toType)
  if (!node || !from || !fromD || !toD) return { ok: false, reason: "not-a-render" }
  if (from === toType) return { ok: false, reason: "same-type" }
  if (!renderMediaHandleOf(from) || !renderMediaHandleOf(toType)) return { ok: false, reason: "no-media-output" }

  const data = (node.data ?? {}) as Record<string, unknown>
  const toDefaults = (definitionOf(toType)?.defaultData ?? {}) as Record<string, unknown>
  if (fromD.mediumOf(data) !== toD.mediumOf(toDefaults)) return { ok: false, reason: "medium" }

  const toInputs = new Set(definitionOf(toType)?.inputs ?? [])
  const kept: RenderSwapWire[] = []
  const moved: (RenderSwapWire & { to: string })[] = []
  const dropped: RenderSwapWire[] = []
  for (const e of edges) {
    if (e.target === nodeId) {
      const handle = e.targetHandle ?? ""
      const wire: RenderSwapWire = { edgeId: e.id, direction: "in", handle, nodeId: e.source }
      ;(toInputs.has(handle) ? kept : dropped).push(wire)
    } else if (e.source === nodeId) {
      const handle = e.sourceHandle ?? renderMediaHandleOf(from)!
      const wire: RenderSwapWire = { edgeId: e.id, direction: "out", handle, nodeId: e.target }
      const to = outputHandleOn(from, toType, e.sourceHandle)
      if (to === null) dropped.push(wire)
      else moved.push({ ...wire, to })
    }
  }

  // TA1: a dropped input wire must not be where the edit's cameras come from.
  // When the edit cannot tell yet, the swap goes ahead and the plan says so.
  let camerasUnjudged = false
  if (dropped.some((w) => w.direction === "in")) {
    const renders = resolveApplyEdlRenders(node, nodes, edges)
    const settings = applyEdlRenderSettings(data)
    if (camerasFromSources(renders, settings)) return { ok: false, reason: "cameras-from-sources" }
    camerasUnjudged = camerasUnknown(renders, settings)
  }
  return {
    ok: true,
    kept,
    moved,
    dropped,
    camerasUnjudged,
    inline: inlineInputs(data, from, toType),
    appItems: appItemsOf(node, toType, presentation),
  }
}

type Column = { connectedSourceId?: string; connectedSourceHandle?: string }

/** A List's columns that read the old node follow its wire (id and pip), or
 *  are cleared, as a delete clears them, when the wire was dropped. */
function followColumns(data: Record<string, unknown>, oldId: string, newId: string, handleMap: ReadonlyMap<string, string | null>): Record<string, unknown> {
  const columns = data.columns
  if (!Array.isArray(columns)) return data
  let changed = false
  const next = columns.map((c: Column) => {
    if (!c || c.connectedSourceId !== oldId) return c
    changed = true
    const to = c.connectedSourceHandle === undefined ? undefined : handleMap.get(c.connectedSourceHandle)
    if (to === null) return { ...c, connectedSourceId: undefined, connectedSourceHandle: undefined }
    return { ...c, connectedSourceId: newId, ...(to !== undefined ? { connectedSourceHandle: to } : {}) }
  })
  return changed ? { ...data, columns: next } : data
}

type FieldMappings = Record<string, { sourceNodeId?: string } | undefined>

/** A node no wire joins to the old node any more drops its field mappings to
 *  it, as the editor does when the last wire between two nodes is deleted. */
function dropFieldMappings(data: Record<string, unknown>, oldId: string): Record<string, unknown> {
  const fm = data.fieldMappings as FieldMappings | undefined
  if (!fm || typeof fm !== "object") return data
  const kept = Object.entries(fm).filter(([, v]) => v?.sourceNodeId !== oldId)
  return kept.length === Object.keys(fm).length ? data : { ...data, fieldMappings: Object.fromEntries(kept) }
}

/**
 * Replace node `nodeId` with a new `toType` node (`replacement.id`, starting
 * from `replacement.data` — the new type's defaults), as `planRenderSwap`
 * describes. The graph is not changed when the swap is refused.
 */
export function replaceRenderNode(
  graph: { readonly nodes: readonly WorkflowNode[]; readonly edges: readonly WorkflowEdge[] },
  nodeId: string,
  toType: string,
  replacement: { readonly id: string; readonly data: Record<string, unknown> },
  presentation?: RenderSwapPresentation,
): RenderSwapResult {
  const plan = planRenderSwap(nodeId, graph.nodes, graph.edges, toType, presentation)
  if (!plan.ok) return plan
  const old = graph.nodes.find((n) => n.id === nodeId)!
  const oldData = (old.data ?? {}) as Record<string, unknown>
  const newId = replacement.id
  const definition = definitionOf(toType)

  const dropped = new Set(plan.dropped.map((w) => w.edgeId))
  const movedTo = new Map(plan.moved.map((w) => [w.edgeId, w.to]))
  const handleMap = new Map<string, string | null>([
    ...plan.moved.map((w) => [w.handle, w.to] as const),
    ...plan.dropped.filter((w) => w.direction === "out").map((w) => [w.handle, null] as const),
  ])
  const downstream = new Set(plan.moved.map((w) => w.nodeId).concat(plan.dropped.filter((w) => w.direction === "out").map((w) => w.nodeId)))

  const edges = graph.edges.flatMap((e): WorkflowEdge[] => {
    if (dropped.has(e.id)) return []
    if (e.target === nodeId) return [{ ...e, target: newId }]
    if (e.source === nodeId) return [{ ...e, source: newId, sourceHandle: movedTo.get(e.id)! }]
    return [e]
  })

  // The node's own app flags (`presentationInput`, `presentationDisplay`, …).
  const appFlags = Object.fromEntries(Object.entries(oldData).filter(([k]) => k.startsWith("presentation")))
  const data: Record<string, unknown> = {
    ...replacement.data,
    ...appFlags,
    ...Object.fromEntries(plan.inline.map((h) => [h, asText(oldData[h])])),
    ...(typeof oldData.label === "string" && oldData.label !== defaultLabelOf(old.type) ? { label: oldData.label } : {}),
    ...(oldData.quality !== undefined ? { quality: oldData.quality } : {}),
  }
  const { width: _w, height: _h, measured: _m, ...placement } = old as WorkflowNode & { measured?: unknown }
  const swapped = {
    ...placement,
    id: newId,
    type: toType,
    data,
    ...(definition?.width ? { width: definition.width } : {}),
    ...(definition?.height ? { height: definition.height } : {}),
  } as WorkflowNode

  const stillWired = new Set(edges.filter((e) => e.source === newId).map((e) => e.target))
  const nodes = graph.nodes.map((n) => {
    if (n.id === nodeId) return swapped
    if (!downstream.has(n.id)) return n
    const nd = (n.data ?? {}) as Record<string, unknown>
    const columns = followColumns(nd, nodeId, newId, handleMap)
    const followed = stillWired.has(n.id) ? columns : dropFieldMappings(columns, nodeId)
    const renamed = renameNodeId(followed, nodeId, newId) as Record<string, unknown>
    return renamed === nd ? n : ({ ...n, data: renamed } as WorkflowNode)
  })
  return {
    ok: true,
    nodes,
    edges,
    plan,
    ...(presentation ? { presentationSettings: renameNodeId(presentation, nodeId, newId) as RenderSwapPresentation } : {}),
  }
}
