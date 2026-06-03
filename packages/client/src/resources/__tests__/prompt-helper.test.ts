import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NodaroError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}
function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}

describe("promptHelper resource", () => {
  it("analyze POSTs action=analyze and returns questions (no selections sent)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ jobId: "j", questions: [{ category: "subject", label: "?", options: [{ value: "cat", label: "Cat" }], selected: "cat", allowCustom: true }] }),
    )
    const c = make(fetchMock)
    const res = await c.promptHelper.analyze({ nodeType: "generate-image", prompt: "a cat" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/prompt-helper/wizard")
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent.action).toBe("analyze")
    expect(sent.nodeType).toBe("generate-image")
    expect(sent.selections).toBeUndefined()
    expect(res.questions[0].category).toBe("subject")
  })

  it("generate POSTs action=generate with selections", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j", prompt: "a photorealistic cat" }))
    const c = make(fetchMock)
    const res = await c.promptHelper.generate({ nodeType: "generate-image", selections: [{ category: "subject", value: "cat", isCustom: false }] })
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent.action).toBe("generate")
    expect((sent.selections as Array<{ value: string }>)[0].value).toBe("cat")
    expect(res.prompt).toBe("a photorealistic cat")
  })

  it("enhance POSTs action=enhance, no selections, threads workflowId", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j", prompt: "cinematic snow leopard" }))
    const c = make(fetchMock)
    const res = await c.promptHelper.enhance({ nodeType: "generate-image", prompt: "snow leopard", workflowId: "wf-1" })
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent.action).toBe("enhance")
    expect(sent.selections).toBeUndefined()
    expect(sent.workflowId).toBe("wf-1")
    expect(res.prompt).toBe("cinematic snow leopard")
  })

  it("threads optional context fields (provider, nodeContext) through the body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j", prompt: "x" }))
    const c = make(fetchMock)
    await c.promptHelper.enhance({
      nodeType: "generate-image",
      prompt: "a cat",
      provider: "flux",
      nodeContext: { referenceImageUrls: ["https://x/y.png"] },
    })
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(sent.provider).toBe("flux")
    expect((sent.nodeContext as { referenceImageUrls: string[] }).referenceImageUrls).toEqual(["https://x/y.png"])
  })

  it("throws a typed NodaroError on a 4xx", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(400, { error: { code: "validation_error", message: "bad" } }))
    const c = make(fetchMock)
    await expect(c.promptHelper.enhance({ nodeType: "generate-image" })).rejects.toBeInstanceOf(NodaroError)
  })
})
