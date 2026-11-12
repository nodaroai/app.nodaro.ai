import { apiJson } from "@/lib/api"
import type { SplitIntoLayersData } from "./types"

/** What a run sends: the image and its settings, as the route reads them (backend/src/nodes/split-into-layers/route.ts). */
export interface SplitIntoLayersRequest {
  readonly imageUrl: string
  readonly maxLayers: number
  readonly size: NonNullable<SplitIntoLayersData["size"]>
  /** Left out when empty: the main elements are found without one. */
  readonly prompt?: string
}

/** Start a Split into Layers job (POST /v1/split-into-layers); the editor polls it. */
export async function splitIntoLayersApi(req: SplitIntoLayersRequest, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { imageUrl: req.imageUrl, maxLayers: req.maxLayers, size: req.size }
  if (req.prompt) body.prompt = req.prompt
  if (userId) body.userId = userId
  return apiJson("/v1/split-into-layers", { body, workflowId: true, label: "apiErr.startSplitIntoLayers" })
}
