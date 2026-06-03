import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError, NodaroError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("objects resource", () => {
  it("list GETs /v1/objects without query params by default", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ objects: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.list()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/objects")
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")
  })

  it("list passes archived=true through the query string", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ objects: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.list({ archived: true })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("archived=true")
  })

  it("list omits archived when archived=false to preserve server default", async () => {
    // archived=false would shadow the route's default (which already filters
    // out soft-deleted rows). Letting `false` through would just be noise — we
    // omit it so the wire payload matches the intent.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ objects: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.list({ archived: false })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain("archived")
  })

  it("list passes projectId through the query string", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ objects: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.list({ projectId: "proj-uuid" })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("projectId=proj-uuid")
  })

  it("listArchived delegates to list with archived=true", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ objects: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.listArchived()
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("archived=true")
  })

  it("get GETs /v1/objects/:id and url-encodes the id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "x" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.get("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/objects/uuid-1")
  })

  it("get throws NotFoundError on 404 (uniform Pass 10 F-90b)", async () => {
    // Object route deliberately diverges from location's per-path codes:
    // archived / cross-user / nonexistent all collapse to "not_found".
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Object not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.objects.get("missing")).rejects.toBeInstanceOf(NotFoundError)
  })

  it("create POSTs /v1/objects with the body (no id => insert)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "new-id" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.create({
      nodeId: "node-1",
      name: "Magic Sword",
      category: "weapon",
      style: "realistic",
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/objects")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      nodeId: "node-1",
      name: "Magic Sword",
      category: "weapon",
      style: "realistic",
    })
    expect(body.id).toBeUndefined()
  })

  it("update POSTs /v1/objects with the id injected into the body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "uuid-1", updatedAt: "2026-05-21T00:00:00.000Z" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.update("uuid-1", { styleLock: false })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/objects")
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
      mockOk({ id: "uuid-1", updatedAt: "2026-05-21T00:00:01.000Z" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.update("uuid-1", {
      canonicalDescription: "fresh caption",
      expectedUpdatedAt: "2026-05-21T00:00:00.000Z",
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.expectedUpdatedAt).toBe("2026-05-21T00:00:00.000Z")
    expect(body.canonicalDescription).toBe("fresh caption")
  })

  it("update throws NodaroError(concurrent_modification) on 409", async () => {
    // Per Phase E1 calibration: the SDK does NOT throw a dedicated
    // ConcurrentModificationError — `throwFromResponse` falls through to a
    // generic NodaroError with the route's `code`. Consumers can branch on
    // `err.code === "concurrent_modification"` to extract the fresh
    // `updatedAt` token from the route body (which is included in the
    // surfaced error object).
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, {
        error: {
          code: "concurrent_modification",
          updatedAt: "2026-05-21T00:00:02.000Z",
          message: "Object was modified concurrently",
        },
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.objects.update("uuid-1", {
        name: "stale",
        expectedUpdatedAt: "2026-05-21T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "concurrent_modification",
      status: 409,
    })
  })

  it("delete DELETEs /v1/objects/:id (soft-delete by default)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ success: true, archived: true }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.objects.delete("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/objects/uuid-1")
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE")
    expect(result).toEqual({ success: true, archived: true })
  })

  it("permanentDelete DELETEs /v1/objects/:id?permanent=true (hard-delete)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ success: true, permanent: true }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.objects.permanentDelete("uuid-1")
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("/v1/objects/uuid-1")
    expect(url).toContain("permanent=true")
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE")
    expect(result).toEqual({ success: true, permanent: true })
  })

  it("permanentDelete surfaces NodaroError(not_archived) on 400", async () => {
    // The route enforces archive-first: an active row returns 400
    // "not_archived" to guard against curl/SDK callers bypassing the UI
    // archive-first flow.
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(400, {
        error: {
          code: "not_archived",
          message: "Object must be archived before permanent deletion",
        },
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.objects.permanentDelete("uuid-1")).rejects.toMatchObject({
      code: "not_archived",
      status: 400,
    })
  })

  it("restore POSTs /v1/objects/:id/restore", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "uuid-1", name: "Magic Sword" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.objects.restore("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/objects/uuid-1/restore",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(result.name).toBe("Magic Sword")
  })

  it("generate POSTs /v1/generate-object with the single-candidate body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1", jobIds: ["job-1"] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.generate({
      name: "Magic Sword",
      description: "an enchanted longsword",
      count: 1,
      attachToObjectId: "uuid-1",
      category: "weapon",
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-object",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.count).toBe(1)
    expect(body.attachToObjectId).toBe("uuid-1")
    expect(body.category).toBe("weapon")
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
    const result = await c.objects.generate({ name: "Magic Sword", count: 1 })
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
    const result = await c.objects.generate({ name: "Magic Sword", count: 1 })
    expect(result.jobIds).toEqual(["x"])
    expect(result.jobId).toBe("x")
  })

  it("generate returns the multi-candidate {jobIds} shape on count=4 (no jobId alias)", async () => {
    // Multi-candidate batches return `{ jobIds: string[] }` and intentionally
    // skip the `attachToObjectId` auto-attach (the user must approve a
    // winner via approveMainImage). No deprecated `jobId` alias for count>1.
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ jobIds: ["j1", "j2", "j3", "j4"] }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.objects.generate({ name: "Magic Sword", count: 4 })
    expect(result.jobIds.length).toBe(4)
    expect(result.jobId).toBeUndefined()
  })

  it("generate threads seedPromptHint through to the body (Pass 7 F-77)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.generate({
      name: "Magic Sword",
      seedPromptHint: "antique brass pommel, leather-wrapped grip",
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.seedPromptHint).toBe("antique brass pommel, leather-wrapped grip")
  })

  it("generateAsset POSTs /v1/generate-object-asset with the body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-2" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.generateAsset({
      assetType: "materials",
      variant: "wood",
      name: "Magic Sword",
      attachToObjectId: "uuid-1",
      attachToColumn: "materials",
      attachName: "wood",
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-object-asset",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.assetType).toBe("materials")
    expect(body.variant).toBe("wood")
    expect(body.attachToColumn).toBe("materials")
    expect(body.attachToObjectId).toBe("uuid-1")
  })

  it("generateAsset accepts all 4 OBJECT_ATTACH_COLUMNS values", async () => {
    // attachToColumn is typed as the OBJECT_ATTACH_COLUMNS union (4 values:
    // angles / materials / variations / motion_clips). This test exercises
    // each at the type level (compile-time) AND verifies that all 4 land on
    // the wire shape correctly.
    const columns = ["angles", "materials", "variations", "motion_clips"] as const
    for (const col of columns) {
      const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: `job-${col}` }))
      const c = createClient({
        baseUrl: "https://api.example.com",
        auth: new StaticTokenAuth("t"),
        fetch: fetchMock,
      })
      await c.objects.generateAsset({
        assetType: col === "motion_clips" ? "motion" : (col as "angles" | "materials" | "variations"),
        variant: "test",
        name: "Magic Sword",
        attachToObjectId: "uuid-1",
        attachToColumn: col,
        attachName: "test",
      })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.attachToColumn).toBe(col)
    }
  })

  it("generateMotion POSTs /v1/generate-object-motion with the body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-1" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.objects.generateMotion({
      motionPrompt: "slow rotation",
      sourceImageUrl: "https://example.com/main.jpg",
      name: "Magic Sword",
    })
    expect(result.jobId).toBe("j-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-object-motion",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({
      motionPrompt: "slow rotation",
      sourceImageUrl: "https://example.com/main.jpg",
      name: "Magic Sword",
    })
  })

  it("generateMotion threads attach + aspectRatio fields when set", async () => {
    // Studio auto-attach path: when attachToObjectId + attachName are set
    // alongside aspectRatio, the worker appends `{ name: attachName, url:
    // <result> }` to the row's `motion_clips` column. The SDK passes
    // everything through unchanged. Objects default to 1:1 server-side but
    // 4:3 / 16:9 / 9:16 are all valid overrides via the 5-value object enum.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-2" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.generateMotion({
      motionPrompt: "drone-orbit around the sword",
      sourceImageUrl: "https://r2/main.png",
      provider: "kling-turbo",
      name: "Magic Sword",
      category: "weapon",
      style: "realistic",
      canonicalDescription: "A medieval longsword, leather-wrapped grip...",
      attachToObjectId: "uuid-1",
      attachName: "drone-orbit",
      aspectRatio: "4:3",
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.provider).toBe("kling-turbo")
    expect(body.attachToObjectId).toBe("uuid-1")
    expect(body.attachName).toBe("drone-orbit")
    expect(body.aspectRatio).toBe("4:3")
    expect(body.style).toBe("realistic")
    expect(body.canonicalDescription).toBe("A medieval longsword, leather-wrapped grip...")
  })

  it("approveMainImage POSTs /v1/objects/:id/approve-main-image", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        sourceImageUrl: "https://r2/x.png",
        canonicalDescription: "A medieval longsword...",
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.objects.approveMainImage("uuid-1", "job-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/objects/uuid-1/approve-main-image",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.candidateJobId).toBe("job-1")
    expect(result.sourceImageUrl).toBe("https://r2/x.png")
    // A real caption passes through untouched.
    expect(result.canonicalDescription).toBe("A medieval longsword...")
  })

  it("approveMainImage normalizes the wire \"\" caption → null (WI-7, matches characters)", async () => {
    // The route still sends "" on LLM sub-failure; the SDK normalizes it to
    // null so consumers see the same `string | null` semantics as characters.
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ sourceImageUrl: "https://r2/x.png", canonicalDescription: "" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.objects.approveMainImage("uuid-1", "job-1")
    expect(result.sourceImageUrl).toBe("https://r2/x.png")
    expect(result.canonicalDescription).toBeNull()
  })

  it("get normalizes the wire \"\" caption → null (WI-7)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "uuid-1", name: "Magic Sword", canonicalDescription: "" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.objects.get("uuid-1")
    expect(result.canonicalDescription).toBeNull()
    // Other fields pass through unchanged.
    expect(result.name).toBe("Magic Sword")
  })

  it("get passes a real caption through unchanged (WI-7)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "uuid-1", name: "Magic Sword", canonicalDescription: "A medieval longsword." }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.objects.get("uuid-1")
    expect(result.canonicalDescription).toBe("A medieval longsword.")
  })

  it("approveMainImage threads expectedUpdatedAt when supplied", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        sourceImageUrl: "https://r2/x.png",
        canonicalDescription: "A medieval longsword...",
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.approveMainImage("uuid-1", "job-1", "2026-05-21T00:00:00.000Z")
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.candidateJobId).toBe("job-1")
    expect(body.expectedUpdatedAt).toBe("2026-05-21T00:00:00.000Z")
  })

  it("recaption POSTs /v1/objects/:id/llm-caption with no body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ canonicalDescription: "fresh caption" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.objects.recaption("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/objects/uuid-1/llm-caption",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    // recaption sends no body — the route reads only the :id param. Per
    // Phase E1 calibration: this route is a pure idempotent retry, so the
    // SDK method takes only `id` (no expectedUpdatedAt).
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
  })

  it("recaption surfaces NodaroError(caption_failed) on 502", async () => {
    // Unlike approveMainImage which preserves the side-effect on LLM
    // failure (returns "" caption), recaption returns 502 caption_failed —
    // the route's only purpose IS the caption, so failure must be hard.
    const fetchMock = vi.fn().mockReturnValue(
      mockErr(502, {
        error: {
          code: "caption_failed",
          message: "Failed to caption object image",
        },
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.objects.recaption("uuid-1")).rejects.toBeInstanceOf(NodaroError)
    await expect(c.objects.recaption("uuid-1")).rejects.toMatchObject({
      code: "caption_failed",
      status: 502,
    })
  })

  it("update throws NotFoundError on 404 (uniform Pass 10 F-90b)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Object not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.objects.update("missing", { name: "X" }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
