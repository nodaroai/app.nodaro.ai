import { describe, it, expect, vi, beforeEach } from "vitest"

const uploadMock = vi.fn(async (_buf: Buffer, key: string) => `https://cdn.nodaro.ai/${key}`)
vi.mock("../../../lib/storage.js", () => ({ uploadBufferToR2: (...a: unknown[]) => uploadMock(...(a as [Buffer, string])) }))
vi.mock("node:crypto", async (orig) => ({ ...(await orig<typeof import("node:crypto")>()), randomUUID: () => "fixedid" }))

import { persistExportAsset } from "../_freecut-timeline.js"

function fakeSupabase(captured: { row?: Record<string, unknown> }) {
  return { from: () => ({ insert: (row: Record<string, unknown>) => { captured.row = row; return { select: () => ({ single: async () => ({ data: { id: "asset1" }, error: null }) }) } } }) } as never
}

describe("persistExportAsset", () => {
  beforeEach(() => uploadMock.mockClear())

  it("uses a user-scoped key + null pipeline_id when pipelineId is absent", async () => {
    const captured: { row?: Record<string, unknown> } = {}
    const res = await persistExportAsset({
      supabase: fakeSupabase(captured), userId: "u1",
      filenameStem: "freecut", fileExtension: "json", mimeType: "application/json",
      formatTag: "freecut-v1", content: "{}", logTag: "studio-freecut-export", source: "studio-freecut-export",
    })
    expect(uploadMock.mock.calls[0][1]).toBe("exports/u1/freecut-fixedid.json")
    expect(captured.row?.pipeline_id).toBeNull()
    expect((captured.row?.metadata as { source: string }).source).toBe("studio-freecut-export")
    expect(res.assetId).toBe("asset1")
  })

  it("keeps the pipeline-scoped key + pipeline_id when pipelineId is present", async () => {
    const captured: { row?: Record<string, unknown> } = {}
    await persistExportAsset({
      supabase: fakeSupabase(captured), pipelineId: "p1", userId: "u1",
      filenameStem: "freecut", fileExtension: "json", mimeType: "application/json",
      formatTag: "freecut-v1", content: "{}", logTag: "pipeline-freecut-export", source: "pipeline-freecut-export",
    })
    expect(uploadMock.mock.calls[0][1]).toBe("pipelines/p1/exports/freecut-fixedid.json")
    expect(captured.row?.pipeline_id).toBe("p1")
  })
})
