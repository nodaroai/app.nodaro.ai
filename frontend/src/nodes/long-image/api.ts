import type { LongImageRun } from "@nodaro/render-rules"
import { apiJson } from "@/lib/api"

/**
 * Start a Long Image run (POST /v1/long-image) with the mode's own fields, as
 * the route reads them (backend/src/nodes/long-image/route.ts); the editor
 * polls it. The product pictures keep their places (an empty one is `null`),
 * so `@image_N` in the prompt names the picture wired to input N.
 */
export async function longImageApi(run: LongImageRun, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { ...run }
  if (userId) body.userId = userId
  return apiJson("/v1/long-image", { body, workflowId: true, label: "apiErr.startLongImage" })
}
