import { COMPOSER_PLAN_MAP, scene3DPlanSchemaVersion } from "@nodaro/shared"
import { planRevisionId } from "./plan-view"
import type { Scene3DRevisionEntry } from "@/types/nodes"

/**
 * The revision a 3D Render Pro `scene` source names, and the run that made it.
 *
 * The platform authorizes retained scenes through revision permissions. A
 * recorded source job also lets it locate Basic scenes retained in job history.
 *
 * Precedence mirrors the orchestrator's `resolvePro3DRenderSceneRef` and Edit
 * 3D Scene's plan resolution: a scene wired into `scene` wins over the one
 * this node already holds, because the wired node is what the user is looking
 * at and a graph whose upstream just re-ran must export the fresh revision.
 *
 * Manual revisions can have no source job. Preserve that absence: the server
 * resolves their retained scene without inventing a generation or rerunning it.
 */
export function resolvePro3DSceneRef(
  nodeId: string,
  data: { scenePlan?: unknown; sceneHistory?: readonly Scene3DRevisionEntry[] },
  nodes: ReadonlyArray<{ id: string; type?: string; data?: unknown }>,
  edges: ReadonlyArray<{ source: string; target: string; targetHandle?: string | null }>,
): { revisionId: string; sourceJobId?: string } | undefined {
  const jobIdFor = (
    history: readonly Scene3DRevisionEntry[] | undefined,
    revisionId: string,
  ): string | undefined => history?.find((entry) => entry.revisionId === revisionId)?.jobId

  for (const edge of edges) {
    if (edge.target !== nodeId || edge.targetHandle !== "scene") continue
    const sourceNode = nodes.find((n) => n.id === edge.source)
    const mapping = COMPOSER_PLAN_MAP[sourceNode?.type ?? ""]
    if (!sourceNode || !mapping) continue
    const upstream = (sourceNode.data as Record<string, unknown> | undefined)?.[mapping.planField]
    const revisionId = planRevisionId(upstream as Record<string, unknown> | undefined)
    if (!revisionId) continue
    const history = (sourceNode.data as { sceneHistory?: readonly Scene3DRevisionEntry[] } | undefined)?.sceneHistory
    return { revisionId, sourceJobId: scene3DPlanSchemaVersion(upstream) === 2 ? undefined : jobIdFor(history, revisionId) }
  }

  const own = planRevisionId(data.scenePlan as Record<string, unknown> | undefined)
  return own ? { revisionId: own, sourceJobId: scene3DPlanSchemaVersion(data.scenePlan) === 2 ? undefined : jobIdFor(data.sceneHistory, own) } : undefined
}

/**
 * A fresh `Idempotency-Key` for one submit.
 *
 * Random rather than derived from the request: two deliberate Run clicks are
 * two runs, and a derived key would silently collapse the second into the
 * first. Its value is protecting a RETRY of a single submit — which is why it
 * is generated once per start, not once per attempt.
 */
export function newPro3DIdempotencyKey(): string {
  const random = globalThis.crypto?.randomUUID?.()
  return `pro3d-${random ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`
}
