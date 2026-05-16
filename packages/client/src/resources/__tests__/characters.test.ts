import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("characters resource", () => {
  it("list GETs /v1/characters without query params by default", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ characters: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.list()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/characters")
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")
  })

  it("list passes projectId and archived=true through the query string", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ characters: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.list({ projectId: "proj-1", archived: true })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("projectId=proj-1")
    expect(url).toContain("archived=true")
  })

  it("list omits archived when archived=false to preserve server default", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ characters: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.list({ archived: false })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain("archived")
  })

  it("list serializes the limit param into the query string", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ characters: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.list({ limit: 5 })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("limit=5")
  })

  it("list omits limit from the query string when not supplied", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ characters: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.list()
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain("limit")
  })

  it("update sends only the supplied keys (omits name when not passed)", async () => {
    // The route ignores `name: undefined` on UPDATE — but earlier SDK builds
    // forced `name: string`, so a partial update like `{ gender: "female" }`
    // typechecked only via an empty string fallback that the route 400'd as
    // `min(1)`. The optional-name SDK type lets us send just the keys the
    // caller actually wants to change.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "kira-id" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.update("kira-id", { nodeId: "mcp-managed", gender: "female" })
    const init = fetchMock.mock.calls[0][1] as { body: string }
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body.id).toBe("kira-id")
    expect(body.gender).toBe("female")
    expect(body.name).toBeUndefined()
  })

  it("get GETs /v1/characters/:id and url-encodes the id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "x" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.get("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/characters/uuid-1")
  })

  it("get throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Character not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.characters.get("missing")).rejects.toBeInstanceOf(NotFoundError)
  })

  it("upsert POSTs /v1/characters with the full body (no id => create)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "new-id" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.upsert({ nodeId: "node-1", name: "Kira" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/characters")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body).toEqual({ nodeId: "node-1", name: "Kira" })
  })

  it("create is a convenience for upsert without id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "new-id" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.create({ nodeId: "node-1", name: "Kira" })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.id).toBeUndefined()
    expect(body.name).toBe("Kira")
  })

  it("update injects the id into the upsert body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "uuid-1" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.update("uuid-1", { nodeId: "node-1", name: "Kira Updated" })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.id).toBe("uuid-1")
    expect(body.name).toBe("Kira Updated")
  })

  it("delete DELETEs /v1/characters/:id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ success: true, archived: true }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.characters.delete("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/characters/uuid-1")
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE")
    expect(result).toEqual({ success: true, archived: true })
  })

  it("restore POSTs /v1/characters/:id/restore", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "uuid-1", name: "Kira" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.restore("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/characters/uuid-1/restore",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
  })

  it("duplicate POSTs /v1/characters/:id/duplicate with body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "new-id", name: "Kira (copy)" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.duplicate("uuid-1", { nodeId: "node-2", projectId: "proj-2" })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/characters/uuid-1/duplicate",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ nodeId: "node-2", projectId: "proj-2" })
  })

  it("usage GETs /v1/characters/:id/usage", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ workflowCount: 0, workflows: [] }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.usage("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/characters/uuid-1/usage",
    )
  })

  it("generate POSTs /v1/generate-character with the full body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ jobId: "job-1", jobIds: ["job-1"] }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.generate({
      name: "Kira",
      seedPrompt: "warrior with dark hair",
      count: 2,
      attachToCharacterId: "uuid-1",
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-character",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.count).toBe(2)
    expect(body.attachToCharacterId).toBe("uuid-1")
  })

  it("generateAsset POSTs /v1/generate-character-asset", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-2" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.generateAsset({
      assetType: "expressions",
      variant: "smile",
      name: "Kira",
      attachToCharacterId: "uuid-1",
      attachToColumn: "expressions",
      attachName: "smile",
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-character-asset",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.assetType).toBe("expressions")
    expect(body.attachToColumn).toBe("expressions")
  })

  it("generateMotion POSTs /v1/generate-character-motion", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-3" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.generateMotion({
      motionPrompt: "walking",
      name: "Kira",
      attachToCharacterId: "uuid-1",
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-character-motion",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.motionPrompt).toBe("walking")
  })

  it("approvePortrait POSTs /v1/characters/:id/approve-portrait", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ portraitUrl: "https://r2/x.png", canonicalDescription: "..." }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.approvePortrait("uuid-1", "job-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/characters/uuid-1/approve-portrait",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ candidateJobId: "job-1" })
  })

  it("recaption POSTs /v1/characters/:id/llm-caption", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ canonicalDescription: "fresh caption" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.characters.recaption("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/characters/uuid-1/llm-caption",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
  })

  it("upsert throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Character not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.characters.update("missing", { nodeId: "node-1", name: "X" }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
