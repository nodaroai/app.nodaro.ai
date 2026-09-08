import { z } from "zod"
import { editRetainedScene3D, Scene3DRetainedEditError } from "../../services/scene3d/scene3d-retained-edit.js"
import { retainedScene3DEditBodySchema } from "../../services/scene3d/scene3d-retained-edit-schema.js"
import type { Scene3DObjectStore } from "../../services/scene3d-artifacts/object-store.js"
import type { PluginSceneJobEditRequest } from "./scene3d-artifact-contract.js"

const inputSchema = retainedScene3DEditBodySchema.extend({ jobId: z.uuid(), userId: z.uuid(), revisionId: z.uuid() })

/** The same retained edit as the HTTP route, guarded by the running job too.
 * A stable newRevisionId makes queue replay adopt the existing revision.
 * Completion and any output policy remain the owning worker's responsibility.
 */
export async function applyScene3DJobEdits(
  deps: { store: Scene3DObjectStore; authorizeJob(scope: { jobId: string; userId: string }): Promise<unknown> },
  raw: PluginSceneJobEditRequest,
  options: { signal?: AbortSignal } = {},
) {
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) throw new Scene3DRetainedEditError(400, "validation_error", "Invalid deterministic scene edit")
  const { jobId, userId, ...input } = parsed.data
  const assertActive = async () => {
    options.signal?.throwIfAborted()
    await deps.authorizeJob({ jobId, userId })
    options.signal?.throwIfAborted()
  }
  const result = await editRetainedScene3D(userId, input, deps.store, { assertActive })
  await assertActive()
  return result
}
