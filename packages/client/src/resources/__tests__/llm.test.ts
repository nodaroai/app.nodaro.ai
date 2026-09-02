import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}
function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}
const body = { system: "S", input: "I", jsonSchema: { type: "object" }, schemaName: "studio_production", origin: "studio" }

describe("llm resource", () => {
  it("structured POSTs the body to /v1/llm/structured and returns the typed answer", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j1", output: { title: "x" }, usage: { inputTokens: 1, outputTokens: 2 } }))
    const out = await client(fetchMock).llm.structured<{ title: string }>(body)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/llm/structured")
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body)
    expect(out.output.title).toBe("x")
  })
  it("structuredJob POSTs to /v1/llm/structured/jobs with label / videoUrl / videoAnalysis and returns { jobId }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j2" }))
    const input = { ...body, label: "Rome", videoUrl: "https://r2/clip.mp4", videoAnalysis: { llmModel: "mixed", selectionMode: "combine" as const } }
    const out = await client(fetchMock).llm.structuredJob(input)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/llm/structured/jobs")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input)
    expect(out).toEqual({ jobId: "j2" })
  })
  it("structuredJob throws the typed error on an old platform's 404 (feature-detect)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(404, { error: { code: "not_found", message: "Route not found" } }))
    await expect(client(fetchMock).llm.structuredJob(body)).rejects.toBeInstanceOf(NotFoundError)
  })
})
