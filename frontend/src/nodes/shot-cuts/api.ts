import { apiJson } from "@/lib/api"

/** Start a Shot Cuts job (POST /v1/shot-cuts, backend/src/nodes/shot-cuts/route.ts); the editor polls it. */
export async function shotCutsApi(body: { videoUrl: string; frames: boolean }, userId?: string): Promise<{ jobId: string }> {
  return apiJson("/v1/shot-cuts", {
    body: { ...body, ...(userId ? { userId } : {}) },
    workflowId: true,
    label: "apiErr.startShotCuts",
  })
}
