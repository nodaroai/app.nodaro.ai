import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("locations resource", () => {
  it("list GETs /v1/locations without query params by default", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ locations: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.list()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/locations")
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")
  })

  it("list passes archived=true through the query string", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ locations: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.list({ archived: true })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("archived=true")
  })

  it("list omits archived when archived=false to preserve server default", async () => {
    // archived=false would shadow the route's default (which already filters
    // out soft-deleted rows). Letting `false` through would just be noise — we
    // omit it so the wire payload matches the intent.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ locations: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.list({ archived: false })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain("archived")
  })

  it("listArchived delegates to list with archived=true", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ locations: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.listArchived()
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("archived=true")
  })

  it("get GETs /v1/locations/:id and url-encodes the id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "x" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.get("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/locations/uuid-1")
  })

  it("get throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Location not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.locations.get("missing")).rejects.toBeInstanceOf(NotFoundError)
  })

  it("create POSTs /v1/locations with the body (no id => insert)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "new-id" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.create({
      nodeId: "node-1",
      name: "Mystic Forest",
      category: "nature",
      style: "realistic",
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/locations")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      nodeId: "node-1",
      name: "Mystic Forest",
      category: "nature",
      style: "realistic",
    })
    expect(body.id).toBeUndefined()
  })

  it("update POSTs /v1/locations with the id injected into the body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "uuid-1", updatedAt: "2026-05-18T00:00:00.000Z" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.update("uuid-1", { styleLock: false })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/locations")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body.id).toBe("uuid-1")
    expect(body.styleLock).toBe(false)
    // Confirm we don't accidentally smuggle other fields when caller only
    // wanted to flip styleLock.
    expect(body.name).toBeUndefined()
  })

  it("update threads expectedUpdatedAt for optimistic concurrency", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "uuid-1", updatedAt: "2026-05-18T00:00:01.000Z" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.update("uuid-1", {
      canonicalDescription: "fresh caption",
      expectedUpdatedAt: "2026-05-18T00:00:00.000Z",
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.expectedUpdatedAt).toBe("2026-05-18T00:00:00.000Z")
    expect(body.canonicalDescription).toBe("fresh caption")
  })

  it("delete DELETEs /v1/locations/:id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ success: true, archived: true }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.locations.delete("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/locations/uuid-1")
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE")
    expect(result).toEqual({ success: true, archived: true })
  })

  it("restore POSTs /v1/locations/:id/restore", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "uuid-1", name: "Mystic Forest" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.locations.restore("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/locations/uuid-1/restore",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(result.name).toBe("Mystic Forest")
  })

  it("generate POSTs /v1/generate-location with the body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1", jobIds: ["job-1"] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.generate({
      name: "Mystic Forest",
      description: "an old growth forest at dawn",
      count: 1,
      attachToLocationId: "uuid-1",
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-location",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.count).toBe(1)
    expect(body.attachToLocationId).toBe("uuid-1")
  })

  it("generate returns jobIds always present, plus the deprecated jobId alias on count=1 (WI-7)", async () => {
    // Harmonized contract: count=1 now returns BOTH `jobIds` (always present)
    // and the deprecated `jobId` back-compat alias.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1", jobIds: ["job-1"] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.locations.generate({ name: "Mystic Forest", count: 1 })
    expect(result.jobIds).toEqual(["job-1"])
    expect(result.jobId).toBe("job-1")
  })

  it("generate synthesizes jobIds from a LEGACY server that returns only { jobId } (WI-7 defensive)", async () => {
    // The SDK ships before the backend route deploys to prod; the consuming
    // app hits prod. An old server returns only `{ jobId }` — the SDK must
    // synthesize `jobIds` so consumers can rely on it unconditionally.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "x" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.locations.generate({ name: "Mystic Forest", count: 1 })
    expect(result.jobIds).toEqual(["x"])
    expect(result.jobId).toBe("x")
  })

  it("generate returns the multi-candidate {jobIds} shape on count=4 (no jobId alias)", async () => {
    // Multi-candidate batches return `{ jobIds: string[] }` and intentionally
    // skip the `attachToLocationId` auto-attach (the user must approve a
    // winner via approveMainImage). No deprecated `jobId` alias for count>1.
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ jobIds: ["j1", "j2", "j3", "j4"] }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.locations.generate({ name: "Mystic Forest", count: 4 })
    expect(result.jobIds.length).toBe(4)
    expect(result.jobId).toBeUndefined()
  })

  it("generateAsset POSTs /v1/generate-location-asset with the body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-2" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.generateAsset({
      assetType: "timeOfDay",
      variant: "dawn",
      name: "Mystic Forest",
      attachToLocationId: "uuid-1",
      attachToColumn: "time_of_day",
      attachName: "dawn",
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-location-asset",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.assetType).toBe("timeOfDay")
    expect(body.variant).toBe("dawn")
    expect(body.attachToColumn).toBe("time_of_day")
  })

  it("generateMotion POSTs /v1/generate-location-motion with the body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-1" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.locations.generateMotion({
      motionPrompt: "slow pan-left",
      sourceImageUrl: "https://example.com/main.jpg",
      name: "Test Location",
    })
    expect(result.jobId).toBe("j-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-location-motion",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({
      motionPrompt: "slow pan-left",
      sourceImageUrl: "https://example.com/main.jpg",
      name: "Test Location",
    })
  })

  it("generateMotion threads attach + aspectRatio fields when set", async () => {
    // Studio auto-attach path: when all three (attachToLocationId +
    // attachName) are set alongside aspectRatio, the worker appends
    // `{ name: attachName, url: <result> }` to the row's atmosphere_motions
    // column. The SDK passes everything through unchanged.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-2" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.generateMotion({
      motionPrompt: "drifting fog rolls across the meadow",
      sourceImageUrl: "https://r2/main.png",
      provider: "kling",
      name: "Mystic Forest",
      category: "nature",
      style: "realistic",
      canonicalDescription: "An old-growth forest at dawn...",
      attachToLocationId: "uuid-1",
      attachName: "fog-drift",
      aspectRatio: "16:9",
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.provider).toBe("kling")
    expect(body.attachToLocationId).toBe("uuid-1")
    expect(body.attachName).toBe("fog-drift")
    expect(body.aspectRatio).toBe("16:9")
    expect(body.style).toBe("realistic")
    expect(body.canonicalDescription).toBe("An old-growth forest at dawn...")
  })

  it("approveMainImage POSTs /v1/locations/:id/approve-main-image", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        sourceImageUrl: "https://r2/x.png",
        canonicalDescription: "An old-growth forest at dawn...",
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.locations.approveMainImage("uuid-1", "job-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/locations/uuid-1/approve-main-image",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ candidateJobId: "job-1" })
    expect(result.sourceImageUrl).toBe("https://r2/x.png")
  })

  it("recaption POSTs /v1/locations/:id/llm-caption with no body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ canonicalDescription: "fresh caption" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.locations.recaption("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/locations/uuid-1/llm-caption",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    // recaption sends no body — the route reads only the :id param.
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
  })

  it("update throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Location not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.locations.update("missing", { name: "X" }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
