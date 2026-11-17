import type { SunoSpeechRun } from "@nodaro/render-rules"
import { apiJson } from "@/lib/api"

/** Start a Suno Speech run (POST /v1/suno-speech) with the mode's own fields; the editor polls it. */
export async function sunoSpeechApi(run: SunoSpeechRun, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { ...run }
  if (userId) body.userId = userId
  return apiJson("/v1/suno-speech", { body, workflowId: true, label: "apiErr.startSunoSpeech" })
}
