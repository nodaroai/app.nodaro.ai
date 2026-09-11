/**
 * Scene3D layout references on a video node's reference rails — the graph
 * walk behind the two greybox rules. The WORDING lives in `@nodaro/prompts`
 * (`scene3d-reference-doctrine.ts`, FSL); this file decides WHICH wired
 * reference is a Scene3D clay render, what it carries, and which seat it sits
 * on, then asks the doctrine for the words.
 *
 * Rule 1 — a scoping line per layout reference. A Scene3D render attached as a
 * video reference is a style anchor as much as a layout anchor: unscoped, a
 * greybox in gives a greybox out. The line rides the platform's existing rail
 * caption seat (`videoCaptions` on `resolveVideoReferenceCore`, rendered as
 * `@video_N: <caption>.`) — the SAME seat an API caller fills through
 * `referenceVideoCaptions[N]` — so the DAG and a hand-written API request put
 * the identical sentence in the identical place. A still on an image seat has
 * no caption seat, so its line is appended to the body in the same rendered
 * form.
 *
 * Rule 2 — one character reference per figure. Photoreal treatment is granted
 * per referenced subject: a figure with no reference of its own inherits the
 * clay look. Surfaced as a `scene3d_unreferenced_figures` WARNING on the job
 * (the payload spreads into `jobs.input_data`, which the owner reads back on
 * `GET /v1/jobs/:id`), never a block — the user may want clay figures.
 *
 * What counts as a Scene3D render, by source node:
 *   - `pro-3d-render` — always (its `video` handle is the clay MP4; its
 *     `composition` handle is a plan marker, not a URL, and is skipped by the
 *     URL check below).
 *   - `render-video` — when the plan it renders is a `3d-scene` plan: its own
 *     `data.plan`, or the `generate-3d-scene` / `edit-3d-scene` /
 *     `pro-3d-render` composer wired into it (`COMPOSER_PLAN_MAP`).
 *   - `extract-frame` — when the clip it extracts from is one of the above
 *     (one hop). What it carries (still vs clip) is decided by the consumer's
 *     handle modality, not by the source, so a producer that later emits
 *     stills directly onto an image seat is covered without an edit here.
 *
 * Seats are found by URL, never by edge order: the resolver built
 * `referenceVideoUrls` from the same `getPrimaryOutput` walk, so the clip's
 * index in that list IS its `@video_N`. A URL that did not survive into the
 * list gets no line — a caption must never bind a seat the payload does not
 * ship (the rule `renderReferenceCaptionLines` already enforces by count).
 */
import {
  COMPOSER_PLAN_MAP,
  SCENE3D_PLAN_TYPE,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  referenceModalityForHandle,
  scene3DPlanSchemaVersion,
  type ExtraRefInput,
} from "@nodaro/shared"
import {
  buildScene3DLayoutScopingLine,
  buildScene3DUnreferencedFiguresWarning,
  hasScene3DLayoutScopingLine,
  renderScene3DLayoutScopingLine,
  type Scene3DLayoutReferenceCarrier,
  type Scene3DLayoutScopingSpec,
  type Scene3DUnreferencedFiguresWarning,
} from "@nodaro/prompts"
import { extractSavedNodeOutput, extractSourceNodeOutput, getPrimaryOutput } from "./output-extractor.js"
import type { NodeExecutionState, ResolvedInputs, SimpleEdge, SimpleNode } from "./types.js"

/** The slice of `PayloadBuildContext` this walk reads — structurally the same
 *  object, typed here so this module does not import payload-builder back. */
export interface Scene3DScopingGraph {
  nodes?: SimpleNode[]
  edges?: SimpleEdge[]
  nodeStates?: Record<string, NodeExecutionState>
}

export interface Scene3DLayoutReference {
  /** The Scene3D render node — the producer itself, or the render behind an
   *  extracted frame. */
  readonly sourceNodeId: string
  readonly carries: Scene3DLayoutReferenceCarrier
  /** 0-based seat in `referenceVideoUrls` (clip) or the leading image list (still). */
  readonly index: number
  /** `@video_N` / `@image_N`, exactly as the model reads the seat. */
  readonly binding: string
  readonly spec: Scene3DLayoutScopingSpec
  /** `person` entities in the v2 composition; undefined for a v1 plan (no
   *  entity roles) or when no plan could be read. */
  readonly figureCount: number | undefined
}

/**
 * A Scene3D plan read STRUCTURALLY — the version marker, the entity list, the
 * shot list, the v1 camera track — never through the full plan schema. The
 * scoping line is doctrine, not validation: a stored revision that predates a
 * schema tightening, or a stub, must still get its line, and an unreadable
 * field means "unknown" (no claim), never a thrown run.
 */
interface Scene3DPlanFacts {
  readonly version: number | null
  readonly personCount: number | undefined
  readonly shotCount: number | undefined
  /** v1 only: a camera track with at least two keyframes is a move. */
  readonly cameraKeyframes: number | undefined
}

interface Scene3DRender {
  node: SimpleNode
  /** `pro` always carries a camera track (v2 schema); `basic` may not. */
  kind: "pro" | "basic"
  plan: Scene3DPlanFacts | undefined
}

/** The plan a composer node holds: this run's output before its saved data —
 *  the precedence `render-video` and `edit-3d-scene` resolve with. */
function planOf(node: SimpleNode, states: Record<string, NodeExecutionState>): unknown {
  const fromRun = states[node.id]?.output?.plan
  if (fromRun) return fromRun
  const field = COMPOSER_PLAN_MAP[node.type]?.planField ?? "scenePlan"
  return node.data[field]
}

function looksLikeScene3DPlan(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && (value as { planType?: unknown }).planType === SCENE3D_PLAN_TYPE
}

function countArray(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined
}

function parseScene3DPlan(value: unknown): Scene3DPlanFacts | undefined {
  if (!looksLikeScene3DPlan(value)) return undefined
  const version = scene3DPlanSchemaVersion(value)
  const objects = Array.isArray(value.objects) ? (value.objects as unknown[]) : undefined
  const personCount =
    version === 2 && objects
      ? objects.filter((entity) => !!entity && typeof entity === "object" && (entity as { role?: unknown }).role === "person").length
      : undefined
  const camera = value.camera
  const cameraKeyframes =
    camera && typeof camera === "object" ? countArray((camera as { keyframes?: unknown }).keyframes) ?? 0 : undefined
  return { version, personCount, shotCount: countArray(value.shots), cameraKeyframes }
}

function incomingSources(node: SimpleNode, graph: Scene3DScopingGraph): Array<{ edge: SimpleEdge; source: SimpleNode }> {
  const out: Array<{ edge: SimpleEdge; source: SimpleNode }> = []
  for (const edge of graph.edges ?? []) {
    if (edge.target !== node.id) continue
    const source = graph.nodes?.find((n) => n.id === edge.source)
    if (source) out.push({ edge, source })
  }
  return out
}

/** The Scene3D render behind a node, or `undefined` when the node is not one. */
function scene3DRenderBehind(node: SimpleNode, graph: Scene3DScopingGraph, depth = 0): Scene3DRender | undefined {
  const states = graph.nodeStates ?? {}
  if (node.type === "pro-3d-render") {
    return { node, kind: "pro", plan: parseScene3DPlan(planOf(node, states)) }
  }
  if (node.type === "render-video") {
    const own = node.data.plan
    if (looksLikeScene3DPlan(own)) return { node, kind: "basic", plan: parseScene3DPlan(own) }
    for (const { source } of incomingSources(node, graph)) {
      const mapping = COMPOSER_PLAN_MAP[source.type]
      if (!mapping || mapping.planType !== SCENE3D_PLAN_TYPE) continue
      const plan = planOf(source, states)
      // A composer that has produced nothing yet renders nothing — and a
      // non-3D plan on a 3D composer's field is not a Scene3D render either.
      if (!looksLikeScene3DPlan(plan)) continue
      return { node, kind: source.type === "pro-3d-render" ? "pro" : "basic", plan: parseScene3DPlan(plan) }
    }
    if (node.data.planType === SCENE3D_PLAN_TYPE) return { node, kind: "basic", plan: undefined }
    return undefined
  }
  if (node.type === "extract-frame" && depth < 1) {
    for (const { source } of incomingSources(node, graph)) {
      const behind = scene3DRenderBehind(source, graph, depth + 1)
      if (behind) return behind
    }
  }
  return undefined
}

/** What the reference carries, from the plan when there is one. */
function specFor(carries: Scene3DLayoutReferenceCarrier, render: Scene3DRender): Scene3DLayoutScopingSpec {
  if (carries === "still") return { carries: "still" }
  const plan = render.plan
  if (!plan) {
    // A Pro revision always carries a camera track (v2 schema); a Basic scene
    // whose plan could not be read gets the generic clip line — claiming a
    // move it may not have would tell the model to match motion it cannot see.
    return render.kind === "pro" ? { carries: "clip", includesCameraMotion: true } : { carries: "clip" }
  }
  if (plan.version === 2) {
    // A v2 revision always carries a camera track; its shot list is the cut list.
    return { carries: "clip", shots: plan.shotCount, includesCameraMotion: true }
  }
  return { carries: "clip", includesCameraMotion: (plan.cameraKeyframes ?? 0) >= 2 }
}

/** `person` entities in a v2 composition; v1 has no entity roles. */
function figureCountOf(plan: Scene3DPlanFacts | undefined): number | undefined {
  return plan?.personCount
}

/**
 * Every Scene3D render wired into `node`'s image / video reference handles,
 * with the seat each one landed on. `leadingImageUrls` is the image list the
 * caller will actually number `@image_1…` from (its reorder applied) — pass it
 * when it differs from `resolvedInputs.referenceImageUrls`.
 */
export function collectScene3DLayoutReferences(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  graph: Scene3DScopingGraph | undefined,
  leadingImageUrls?: readonly string[],
): Scene3DLayoutReference[] {
  if (!graph?.nodes || !graph.edges) return []
  const states = graph.nodeStates ?? {}
  const out: Scene3DLayoutReference[] = []
  const seen = new Set<string>()
  for (const { edge, source } of incomingSources(node, graph)) {
    const modality = referenceModalityForHandle(edge.targetHandle)
    if (modality !== "video" && modality !== "image") continue
    const render = scene3DRenderBehind(source, graph)
    if (!render) continue
    const output = states[source.id]?.output ?? extractSourceNodeOutput(source) ?? extractSavedNodeOutput(source)
    const url = output ? getPrimaryOutput(output, source.type, edge.sourceHandle) : undefined
    if (!url || !/^https?:\/\//.test(url)) continue
    const carries: Scene3DLayoutReferenceCarrier = modality === "video" ? "clip" : "still"
    const list = carries === "clip" ? resolvedInputs.referenceVideoUrls : (leadingImageUrls ?? resolvedInputs.referenceImageUrls)
    const index = list?.indexOf(url) ?? -1
    if (index < 0) continue
    const key = `${carries}:${index}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      sourceNodeId: render.node.id,
      carries,
      index,
      binding: `@${modality}_${index + 1}`,
      spec: specFor(carries, render),
      figureCount: figureCountOf(render.plan),
    })
  }
  return out
}

/**
 * Rule 1 for clips: the `videoCaptions` array for `resolveVideoReferenceCore`,
 * index-aligned with `referenceVideoUrls` (holes are `""`, which the renderer
 * skips). `undefined` when there is nothing to add, so a node with no Scene3D
 * reference keeps its prompt byte-identical. A seat the prompt already scopes
 * — by hand, or on a re-run over a stored prompt — gets no second line.
 */
export function scene3DLayoutVideoCaptions(
  references: readonly Scene3DLayoutReference[],
  prompt: string | undefined,
): string[] | undefined {
  const clips = references.filter((r) => r.carries === "clip" && !hasScene3DLayoutScopingLine(prompt, r.binding))
  if (clips.length === 0) return undefined
  const captions: string[] = []
  for (const clip of clips) {
    while (captions.length <= clip.index) captions.push("")
    captions[clip.index] = buildScene3DLayoutScopingLine(clip.spec)
  }
  return captions
}

/**
 * Rule 1 for stills: an image seat has no caption seat, so the line is appended
 * to the assembled body in the rendered form (`@image_N: <caption>.`) — the
 * same surface a clip's caption renders to. Same idempotence as the captions.
 */
export function appendScene3DStillScopingLines(
  prompt: string | undefined,
  references: readonly Scene3DLayoutReference[],
): string | undefined {
  const stills = references.filter((r) => r.carries === "still" && !hasScene3DLayoutScopingLine(prompt, r.binding))
  if (stills.length === 0) return prompt
  const lines = stills.map((still) => renderScene3DLayoutScopingLine(still.binding, still.spec))
  return prompt ? `${prompt}\n${lines.join("\n")}` : lines.join("\n")
}

/** Node types whose wiring into a video node is a character reference. */
const CHARACTER_SOURCE_TYPES: ReadonlySet<string> = new Set(["character", "face"])

/**
 * Distinct character references the generation carries: every Character /
 * Face node wired into the consumer (any handle — wiring one IS attaching its
 * portrait) plus every extra reference bound to a character slug. Overcounting
 * only silences the warning; undercounting would raise a false one, so the two
 * sets are not cross-deduplicated.
 */
function countCharacterReferences(
  node: SimpleNode,
  graph: Scene3DScopingGraph,
  extraRefs: readonly ExtraRefInput[] | undefined,
): number {
  const wired = new Set<string>()
  for (const { source } of incomingSources(node, graph)) {
    if (CHARACTER_SOURCE_TYPES.has(source.type)) wired.add(source.id)
  }
  const slugs = new Set<string>()
  for (const extra of extraRefs ?? []) {
    if (extra.characterSlug) slugs.add(extra.characterSlug)
  }
  return wired.size + slugs.size
}

/**
 * Rule 2 as the job's warning, or `undefined` when there is nothing to say —
 * no layout reference, no readable v2 composition, or every figure covered.
 * The figure count is the largest any attached composition shows; the budget
 * line uses the provider's image-reference cap when the catalog knows it.
 */
export function scene3DUnreferencedFiguresWarning(args: {
  references: readonly Scene3DLayoutReference[]
  node: SimpleNode
  graph: Scene3DScopingGraph | undefined
  extraRefs?: readonly ExtraRefInput[]
  provider?: string
}): Scene3DUnreferencedFiguresWarning | undefined {
  const counts = args.references.map((r) => r.figureCount).filter((n): n is number => typeof n === "number")
  if (counts.length === 0) return undefined
  const cap = args.provider ? VIDEO_REF_LIMITS_BY_PROVIDER[args.provider]?.images : undefined
  return buildScene3DUnreferencedFiguresWarning({
    figureCount: Math.max(...counts),
    characterReferenceCount: countCharacterReferences(args.node, args.graph ?? {}, args.extraRefs),
    imageReferenceCap: typeof cap === "number" && cap > 0 ? cap : undefined,
    layoutReferenceImageSeats: args.references.filter((r) => r.carries === "still").length,
  })
}
