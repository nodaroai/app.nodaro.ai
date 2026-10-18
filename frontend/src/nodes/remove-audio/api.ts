import { apiJson } from "@/lib/api"

/** Start a Remove Audio job (POST /v1/remove-audio, backend/src/nodes/remove-audio/route.ts). */
export async function removeAudioApi(videoUrl: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/remove-audio", {
    body,
    workflowId: true,
    label: "apiErr.startRemoveAudio",
  })
}
