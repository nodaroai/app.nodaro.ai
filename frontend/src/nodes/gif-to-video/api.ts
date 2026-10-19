import { apiJson } from "@/lib/api"

/** Start a Gif to Video job (POST /v1/gif-to-video, backend/src/nodes/gif-to-video/route.ts). */
export async function gifToVideoApi(
  gifUrl: string,
  opts?: {
    loopToMinimum?: boolean
    targetDuration?: number
    interpolate?: boolean
    alphaBackground?: "white" | "black"
  },
  userId?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { gifUrl }
  if (opts?.loopToMinimum != null) body.loopToMinimum = opts.loopToMinimum
  if (opts?.targetDuration != null) body.targetDuration = opts.targetDuration
  if (opts?.interpolate != null) body.interpolate = opts.interpolate
  if (opts?.alphaBackground != null) body.alphaBackground = opts.alphaBackground
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/gif-to-video", {
    body,
    workflowId: true,
    label: "apiErr.startGifToVideo",
  })
}
