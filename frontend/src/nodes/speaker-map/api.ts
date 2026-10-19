import type { SpeakerMapRunBody } from "@nodaro/render-rules"
import { apiJson } from "@/lib/api"

/** Start a Speaker Map job (POST /v1/speaker-map, backend/src/nodes/speaker-map/route.ts); the editor polls it. */
export async function speakerMapApi(body: SpeakerMapRunBody, userId?: string): Promise<{ jobId: string }> {
  return apiJson("/v1/speaker-map", {
    body: { ...body, ...(userId ? { userId } : {}) },
    workflowId: true,
    label: "apiErr.startSpeakerMap",
  })
}
