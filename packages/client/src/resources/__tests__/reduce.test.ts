import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NodaroError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("reduce resource", () => {
  it("POSTs to /v1/reduce with strategyId / strategyConfig / inputs", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        jobId: "job-1",
        output: "https://r2/picked.jpg",
        meta: { selectedIndex: 0, reasoning: "sharpest", summary: "1 of 3 selected" },
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.reduce.run({
      strategyId: "pick-best-llm",
      strategyConfig: { criteria: "sharpest", inputKind: "image-url" },
      inputs: [
        "https://r2/a.jpg",
        "https://r2/b.jpg",
        "https://r2/c.jpg",
      ],
    })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/reduce")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    const sent = JSON.parse(init.body) as Record<string, unknown>
    expect(sent.strategyId).toBe("pick-best-llm")
    expect((sent.strategyConfig as Record<string, unknown>).criteria).toBe("sharpest")
    expect((sent.inputs as string[]).length).toBe(3)
    expect(result.output).toBe("https://r2/picked.jpg")
    expect(result.meta.selectedIndex).toBe(0)
    expect(result.meta.reasoning).toBe("sharpest")
  })

  it("defaults strategyConfig to {} when omitted", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ jobId: "j", output: "a\n\nb", meta: { summary: "ok" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.reduce.run({ strategyId: "concat", inputs: ["a", "b"] })
    const init = fetchMock.mock.calls[0][1] as { body: string }
    const sent = JSON.parse(init.body) as Record<string, unknown>
    expect(sent.strategyConfig).toEqual({})
  })

  it("threads workflowId when provided", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ jobId: "j", output: "1", meta: { summary: "counted" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.reduce.run({
      strategyId: "count",
      inputs: ["a"],
      workflowId: "wf-1",
    })
    const init = fetchMock.mock.calls[0][1] as { body: string }
    const sent = JSON.parse(init.body) as Record<string, unknown>
    expect(sent.workflowId).toBe("wf-1")
  })

  it("throws a typed NodaroError on a 400 no_valid_inputs response", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(400, { error: { code: "no_valid_inputs", message: "nothing to reduce" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.reduce.run({ strategyId: "first-non-empty", inputs: [""] }),
    ).rejects.toBeInstanceOf(NodaroError)
  })
})
