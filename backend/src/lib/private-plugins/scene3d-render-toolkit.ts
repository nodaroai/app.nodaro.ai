import type { Scene3DPlan } from "@nodaro/shared"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "../job-status.js"
import type { PluginSceneRenderInput, PluginSceneRenderResult, PluginSceneRenderScope,
  PluginSceneRenderStatus, PluginSceneRenderingToolkit } from "./scene3d-render-contract.js"
import { sceneRenderChildId, validateSceneRenderRequest, type SceneRenderRequest } from "./scene3d-render-identity.js"

export interface SceneRenderParent {
  userId: string
  status: string
  stopRequested: boolean
  reservationActive: boolean
}

export interface SceneRenderChild {
  id: string
  parentJobId: string
  userId: string
  inputHash: string
  status: string
  shouldWatermark: boolean
  input: PluginSceneRenderInput & { plan: Scene3DPlan }
  result?: PluginSceneRenderResult
  error?: string
}

export interface SceneRenderPorts {
  parent(scope: PluginSceneRenderScope): Promise<SceneRenderParent | null>
  read(childJobId: string): Promise<SceneRenderChild | null>
  /** Unique child ID: a concurrent winner is returned, never overwritten. */
  create(request: SceneRenderRequest): Promise<SceneRenderChild>
  authorizeAssets(input: SceneRenderRequest["input"], signal?: AbortSignal): Promise<void>
  enqueue(child: SceneRenderChild): Promise<void>
  queue(childJobId: string): Promise<{ state: string; progress: number } | null>
  cancel(child: SceneRenderChild): Promise<void>
}

const RUNNABLE: ReadonlySet<string> = new Set(IN_FLIGHT_JOB_STATUSES.filter((status) => !isParkedJobStatus(status)))
export const isRunnableSceneRenderStatus = (status: string): boolean => RUNNABLE.has(status)
const QUEUED = new Set(["active", "waiting", "delayed", "prioritized", "waiting-children"])

/** An affirmative liveness refusal, distinct from a failed database/queue read. */
export class SceneRenderParentInactiveError extends Error {
  constructor(message: string) { super(message); this.name = "SceneRenderParentInactiveError" }
}

export async function requireSceneRenderParent(ports: SceneRenderPorts, scope: PluginSceneRenderScope, active: boolean): Promise<SceneRenderParent> {
  const parent = await ports.parent(scope)
  if (!parent || parent.userId !== scope.userId) throw new SceneRenderParentInactiveError("Scene render parent is unavailable")
  if (active && ((parent.status !== "pending" && parent.status !== "processing") || parent.stopRequested || !parent.reservationActive)) {
    throw new SceneRenderParentInactiveError("Scene render parent is no longer active or reserved")
  }
  return parent
}

function checkChild(child: SceneRenderChild, scope: PluginSceneRenderScope, inputHash?: string): void {
  if (child.id !== sceneRenderChildId(scope) || child.userId !== scope.userId || child.parentJobId !== scope.parentJobId ||
      child.input.parentJobId !== scope.parentJobId || child.input.userId !== scope.userId || child.input.key !== scope.key ||
      (inputHash !== undefined && child.inputHash !== inputHash)) {
    throw new Error("Scene render identity conflicts with existing work")
  }
}

async function ownedChild(ports: SceneRenderPorts, scope: PluginSceneRenderScope): Promise<SceneRenderChild> {
  await requireSceneRenderParent(ports, scope, false)
  const child = await ports.read(sceneRenderChildId(scope))
  if (!child) throw new Error("Scene render child is unavailable")
  checkChild(child, scope)
  return child
}

async function status(ports: SceneRenderPorts, child: SceneRenderChild): Promise<PluginSceneRenderStatus> {
  const queue = await ports.queue(child.id)
  const drained = !queue || !QUEUED.has(queue.state)
  let state: PluginSceneRenderStatus["state"]
  if (child.status === "completed") state = "completed"
  else if (child.status === "cancelled") state = "cancelled"
  else if (child.status === "failed") state = "failed"
  else if (drained && (child.status === "processing" || queue !== null)) state = "failed"
  else if (child.status === "processing" || queue?.state === "active") state = "running"
  else if (child.status === "pending" || child.status === "queued") state = "pending"
  else throw new Error("Scene render child has an unsupported lifecycle state")
  return { childJobId: child.id, state, drained, progress: Math.min(100, Math.max(0, queue?.progress ?? (state === "completed" ? 100 : 0))),
    ...(state === "completed" && child.result ? { result: child.result } : {}),
    ...(state === "failed" ? { error: "Scene render failed" } : {}) }
}

/** No credit reserve/settle/refund calls: the owning parent alone handles billing. */
export function createSceneRenderingToolkit(ports: SceneRenderPorts): PluginSceneRenderingToolkit {
  return {
    async submit(raw, options) {
      options?.signal?.throwIfAborted()
      const request = await validateSceneRenderRequest(raw)
      const { input, childJobId, inputHash } = request
      await requireSceneRenderParent(ports, input, true)
      options?.signal?.throwIfAborted()
      let child = await ports.read(childJobId)
      const adopted = child !== null
      if (child) checkChild(child, input, inputHash)
      else {
        await ports.authorizeAssets(input, options?.signal)
        options?.signal?.throwIfAborted()
        await requireSceneRenderParent(ports, input, true)
        child = await ports.create(request)
        checkChild(child, input, inputHash)
      }
      if (child.status === "completed") return { childJobId, adopted: true }
      if (!RUNNABLE.has(child.status)) throw new Error("Scene render child is already terminal")
      try {
        options?.signal?.throwIfAborted()
        await requireSceneRenderParent(ports, input, true)
        const queued = await ports.queue(childJobId)
        // A drained queue record with a nonterminal DB row is an inconsistent outcome.
        // Do not remove/recreate it and render the same child again.
        if (queued && !QUEUED.has(queued.state)) throw new Error("Scene render queue outcome is unresolved")
        if (!queued && child.status === "processing") throw new Error("Scene render worker receipt is missing")
        if (!queued) await ports.enqueue(child)
        options?.signal?.throwIfAborted()
        await requireSceneRenderParent(ports, input, true)
      } catch (error) {
        // A read failure during adoption is not a cancellation request. Leave durable work
        // available for a later replay; the worker independently enforces parent liveness.
        if (error instanceof SceneRenderParentInactiveError || (!adopted && options?.signal?.aborted)) {
          await ports.cancel(child)
        }
        throw error
      }
      return { childJobId, adopted }
    },
    async status(scope) { return status(ports, await ownedChild(ports, scope)) },
    async cancel(scope) {
      const child = await ownedChild(ports, scope)
      if (RUNNABLE.has(child.status)) await ports.cancel(child)
      return status(ports, await ownedChild(ports, scope))
    },
  }
}
