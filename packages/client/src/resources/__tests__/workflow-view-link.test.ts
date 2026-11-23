import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { WorkflowViewLink } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response)
}

function call(fetchMock: ReturnType<typeof vi.fn>, n: number) {
  const [url, init] = fetchMock.mock.calls[n] as [string, { method: string; body?: string }]
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }
}

const WF = "00000000-0000-4000-8000-0000000000f1"
const TOKEN = "T".repeat(43)
const ON: WorkflowViewLink = { enabled: true, token: TOKEN, indexable: true, export: null, createdAt: "2026-11-23T10:00:00Z" }

describe("workflows.viewLink", () => {
  it("speaks the view-link wire contract", async () => {
    const fetchMock = vi.fn(() => mockOk(ON))
    const client = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    await client.workflows.viewLink.get(WF)
    await client.workflows.viewLink.enable(WF, { locale: "he" })
    await client.workflows.viewLink.update(WF, { indexable: false })
    await client.workflows.viewLink.saveExport(WF, { includeAssets: true })
    await client.workflows.viewLink.removeExport(WF)
    await client.workflows.viewLink.disable(WF)
    await client.workflows.viewLink.read(TOKEN)
    await client.workflows.viewLink.readExport(TOKEN)
    const base = `https://api.example.com/v1/workflows/${WF}/view-link`
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((n) => call(fetchMock, n))).toEqual([
      { url: base, method: "GET", body: undefined },
      { url: base, method: "POST", body: { locale: "he" } },
      { url: base, method: "PATCH", body: { indexable: false } },
      { url: `${base}/export`, method: "POST", body: { includeAssets: true } },
      { url: `${base}/export`, method: "DELETE", body: undefined },
      { url: base, method: "DELETE", body: undefined },
      { url: `https://api.example.com/v1/workflow-views/${TOKEN}`, method: "GET", body: undefined },
      { url: `https://api.example.com/v1/workflow-views/${TOKEN}/export`, method: "GET", body: undefined },
    ])
  })
})
