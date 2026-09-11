/**
 * Scene3D layout references on a video node's reference rails — the CANVAS
 * twin of `backend/src/services/workflow-engine/scene3d-reference-scoping.ts`.
 *
 * The doctrine's WORDING and its APPLICATION both live in `@nodaro/prompts`
 * (`buildScene3DLayoutScopingLine`, `scene3DLayoutVideoCaptions`,
 * `appendScene3DStillScopingLines`); what cannot be shared is the walk, because
 * the two engines hold different graphs — the orchestrator has `SimpleNode`s
 * plus per-node run states, the canvas has React Flow nodes whose `data` IS the
 * state. This file is that walk, and nothing else, so the only thing that can
 * drift between a workflow run and this node's own Run button is WHICH
 * reference is found, never what is said about it.
 *
 * Why it exists: the API path and the orchestrated DAG have scoped a Scene3D
 * clay reference since the doctrine landed, but a video node's own Run button
 * hands `/v1/generate-video` bare URLs, and the route cannot recover a Scene3D
 * source from a URL. Unscoped, a greybox in gives a greybox out — so the
 * canvas has to say it, from the graph it is the only one holding.
 *
 * What counts as a Scene3D render, by source node (identical to the backend):
 *   - `pro-3d-render` — always.
 *   - `render-video` — when the plan it renders is a `3d-scene` plan: its own
 *     `data.plan`, or the `generate-3d-scene` / `edit-3d-scene` /
 *     `pro-3d-render` composer wired into it (`COMPOSER_PLAN_MAP`).
 *   - `extract-frame` — when the clip it extracts from is one of the above
 *     (one hop). Still vs clip is decided by the CONSUMER's handle modality,
 *     not by the source.
 *
 * Seats are found by URL, never by edge order: the caller resolved its
 * reference lists through `resolveNodeInputs`, so a clip's index in
 * `referenceVideoUrls` IS its `@video_N`. A URL that did not survive into the
 * list gets no line — a caption must never bind a seat the payload does not
 * ship.
 */
import {
  COMPOSER_PLAN_MAP,
  SCENE3D_PLAN_TYPE,
  referenceModalityForHandle,
  scene3DPlanSchemaVersion,
} from "@nodaro/shared"
import type {
  Scene3DLayoutReferenceCarrier,
  Scene3DLayoutReferenceSeat,
  Scene3DLayoutScopingSpec,
} from "@nodaro/prompts"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"

/** Both halves of rule 1's application come from the doctrine package. */
export { scene3DLayoutVideoCaptions, appendScene3DStillScopingLines } from "@nodaro/prompts"

/** The reference lists the consumer will actually ship, in payload order. */
export interface Scene3DScopingInputs {
  readonly referenceVideoUrls?: readonly string[]
  readonly referenceImageUrls?: readonly string[]
}

export interface Scene3DLayoutReference extends Scene3DLayoutReferenceSeat {
  /** The Scene3D render node — the producer itself, or the render behind an
   *  extracted frame. */
  readonly sourceNodeId: string
}

/**
 * A Scene3D plan read STRUCTURALLY — the version marker, the entity list, the
 * shot list, the v1 camera track — never through the full plan schema. The
 * scoping line is doctrine, not validation: a stored revision that predates a
 * schema tightening, or a stub, must still get its line.
 */
interface Scene3DPlanFacts {
  readonly version: number | null
  readonly shotCount: number | undefined
  /** v1 only: a camera track with at least two keyframes is a move. */
  readonly cameraKeyframes: number | undefined
}

interface Scene3DRender {
  node: WorkflowNode
  /** `pro` always carries a camera track (v2 schema); `basic` may not. */
  kind: "pro" | "basic"
  plan: Scene3DPlanFacts | undefined
}

/** The plan a composer node holds. On the canvas a node's own `data` is both
 *  its saved state and its last run's result, so there is no run-state layer to
 *  consult first — the backend's `states[id].output.plan` precedence collapses
 *  to this single read. */
function planOf(node: WorkflowNode): unknown {
  const data = node.data as Record<string, unknown>
  const field = COMPOSER_PLAN_MAP[node.type ?? ""]?.planField ?? "scenePlan"
  return data[field]
}

function looksLikeScene3DPlan(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && (value as { planType?: unknown }).planType === SCENE3D_PLAN_TYPE
}

function countArray(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined
}

function parseScene3DPlan(value: unknown): Scene3DPlanFacts | undefined {
  if (!looksLikeScene3DPlan(value)) return undefined
  const camera = value.camera
  const cameraKeyframes =
    camera && typeof camera === "object" ? countArray((camera as { keyframes?: unknown }).keyframes) ?? 0 : undefined
  return {
    version: scene3DPlanSchemaVersion(value),
    shotCount: countArray(value.shots),
    cameraKeyframes,
  }
}

function incomingSources(
  nodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): Array<{ edge: WorkflowEdge; source: WorkflowNode }> {
  const out: Array<{ edge: WorkflowEdge; source: WorkflowNode }> = []
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const source = nodes.find((n) => n.id === edge.source)
    if (source) out.push({ edge, source })
  }
  return out
}

/** The Scene3D render behind a node, or `undefined` when the node is not one. */
function scene3DRenderBehind(
  node: WorkflowNode,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  depth = 0,
): Scene3DRender | undefined {
  const data = node.data as Record<string, unknown>
  if (node.type === "pro-3d-render") {
    return { node, kind: "pro", plan: parseScene3DPlan(planOf(node)) }
  }
  if (node.type === "render-video") {
    const own = data.plan
    if (looksLikeScene3DPlan(own)) return { node, kind: "basic", plan: parseScene3DPlan(own) }
    for (const { source } of incomingSources(node.id, nodes, edges)) {
      const mapping = COMPOSER_PLAN_MAP[source.type ?? ""]
      if (!mapping || mapping.planType !== SCENE3D_PLAN_TYPE) continue
      const plan = planOf(source)
      // A composer that has produced nothing yet renders nothing — and a
      // non-3D plan on a 3D composer's field is not a Scene3D render either.
      if (!looksLikeScene3DPlan(plan)) continue
      return { node, kind: source.type === "pro-3d-render" ? "pro" : "basic", plan: parseScene3DPlan(plan) }
    }
    if (data.planType === SCENE3D_PLAN_TYPE) return { node, kind: "basic", plan: undefined }
    return undefined
  }
  if (node.type === "extract-frame" && depth < 1) {
    for (const { source } of incomingSources(node.id, nodes, edges)) {
      const behind = scene3DRenderBehind(source, nodes, edges, depth + 1)
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

/**
 * Every Scene3D render wired into `node`'s image / video reference handles,
 * with the seat each one landed on. `leadingImageUrls` is the image list the
 * caller will actually number `@image_1…` from (its reorder applied) — pass it
 * when it differs from `inputs.referenceImageUrls`.
 */
export function collectScene3DLayoutReferences(
  node: WorkflowNode,
  inputs: Scene3DScopingInputs,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  leadingImageUrls?: readonly string[],
): Scene3DLayoutReference[] {
  const out: Scene3DLayoutReference[] = []
  const seen = new Set<string>()
  for (const { edge, source } of incomingSources(node.id, nodes, edges)) {
    const modality = referenceModalityForHandle(edge.targetHandle ?? undefined)
    if (modality !== "video" && modality !== "image") continue
    const render = scene3DRenderBehind(source, nodes, edges)
    if (!render) continue
    const url = extractNodeOutput(source, edge.sourceHandle ?? undefined)
    if (!url || !/^https?:\/\//.test(url)) continue
    const carries: Scene3DLayoutReferenceCarrier = modality === "video" ? "clip" : "still"
    const list = carries === "clip" ? inputs.referenceVideoUrls : (leadingImageUrls ?? inputs.referenceImageUrls)
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
    })
  }
  return out
}
