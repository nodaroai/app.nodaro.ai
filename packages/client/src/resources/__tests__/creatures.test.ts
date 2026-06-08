import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError, NodaroError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("creatures resource", () => {
  it("list GETs /v1/creatures without query params by default", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ creatures: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.list()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/creatures")
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")
  })

  it("list passes archived=true through the query string", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ creatures: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.list({ archived: true })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("archived=true")
  })

  it("list omits archived when archived=false to preserve server default", async () => {
    // archived=false would shadow the route's default (which already filters
    // out soft-deleted rows). Letting `false` through would just be noise — we
    // omit it so the wire payload matches the intent.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ creatures: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.list({ archived: false })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain("archived")
  })

  it("list passes projectId through the query string", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ creatures: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.list({ projectId: "proj-uuid" })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("projectId=proj-uuid")
  })

  it("listArchived delegates to list with archived=true", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ creatures: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.listArchived()
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("archived=true")
  })

  it("get GETs /v1/creatures/:id and url-encodes the id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "x" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.get("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/creatures/uuid-1")
  })

  it("get throws NotFoundError on 404 (uniform not_found)", async () => {
    // Creature route deliberately diverges from location's per-path codes:
    // archived / cross-user / nonexistent all collapse to "not_found".
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Creature not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.creatures.get("missing")).rejects.toBeInstanceOf(NotFoundError)
  })

  it("create POSTs /v1/creatures with the body (no id => insert)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "new-id" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.create({
      nodeId: "node-1",
      name: "Frost Dragon",
      species: "dragon",
      category: "mythical",
      style: "realistic",
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/creatures")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      nodeId: "node-1",
      name: "Frost Dragon",
      species: "dragon",
      category: "mythical",
      style: "realistic",
    })
    expect(body.id).toBeUndefined()
  })

  it("update POSTs /v1/creatures with the id injected into the body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "uuid-1", updatedAt: "2026-06-07T00:00:00.000Z" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.update("uuid-1", { styleLock: false })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/creatures")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body.id).toBe("uuid-1")
    expect(body.styleLock).toBe(false)
    // Confirm we don't accidentally smuggle other fields when caller only
    // wanted to flip styleLock.
    expect(body.name).toBeUndefined()
  })

  it("update threads species + expectedUpdatedAt for optimistic concurrency", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "uuid-1", updatedAt: "2026-06-07T00:00:01.000Z" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.update("uuid-1", {
      species: "wolf",
      canonicalDescription: "fresh caption",
      expectedUpdatedAt: "2026-06-07T00:00:00.000Z",
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.species).toBe("wolf")
    expect(body.expectedUpdatedAt).toBe("2026-06-07T00:00:00.000Z")
    expect(body.canonicalDescription).toBe("fresh caption")
  })

  it("update throws NodaroError(concurrent_modification) on 409", async () => {
    // The SDK does NOT throw a dedicated ConcurrentModificationError —
    // `throwFromResponse` falls through to a generic NodaroError with the
    // route's `code`. Consumers can branch on
    // `err.code === "concurrent_modification"` to extract the fresh
    // `updatedAt` token from the route body.
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, {
        error: {
          code: "concurrent_modification",
          updatedAt: "2026-06-07T00:00:02.000Z",
          message: "Creature was modified concurrently",
        },
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.creatures.update("uuid-1", {
        name: "stale",
        expectedUpdatedAt: "2026-06-07T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "concurrent_modification",
      status: 409,
    })
  })

  it("delete DELETEs /v1/creatures/:id (soft-delete by default)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ success: true, archived: true }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.creatures.delete("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/creatures/uuid-1")
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE")
    expect(result).toEqual({ success: true, archived: true })
  })

  it("permanentDelete DELETEs /v1/creatures/:id?permanent=true (hard-delete)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ success: true, permanent: true }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.creatures.permanentDelete("uuid-1")
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("/v1/creatures/uuid-1")
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
          message: "Creature must be archived before permanent deletion",
        },
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.creatures.permanentDelete("uuid-1")).rejects.toMatchObject({
      code: "not_archived",
      status: 400,
    })
  })

  it("restore POSTs /v1/creatures/:id/restore", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ id: "uuid-1", name: "Frost Dragon" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.creatures.restore("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/creatures/uuid-1/restore",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(result.name).toBe("Frost Dragon")
  })

  it("generate POSTs /v1/generate-creature with the single-candidate body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1", jobIds: ["job-1"] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.generate({
      name: "Frost Dragon",
      description: "an ice-scaled wyrm",
      species: "dragon",
      count: 1,
      attachToCreatureId: "uuid-1",
      category: "mythical",
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-creature",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.count).toBe(1)
    expect(body.attachToCreatureId).toBe("uuid-1")
    expect(body.species).toBe("dragon")
    expect(body.category).toBe("mythical")
  })

  it("generate returns jobIds always present, plus the deprecated jobId alias on count=1", async () => {
    // Harmonized contract: count=1 now returns BOTH `jobIds` (always present)
    // and the deprecated `jobId` back-compat alias.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1", jobIds: ["job-1"] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.creatures.generate({ name: "Frost Dragon", count: 1 })
    expect(result.jobIds).toEqual(["job-1"])
    expect(result.jobId).toBe("job-1")
  })

  it("generate synthesizes jobIds from a LEGACY server that returns only { jobId }", async () => {
    // The SDK ships before the backend route deploys to prod; the consuming
    // app hits prod. An old server returns only `{ jobId }` — the SDK must
    // synthesize `jobIds` so consumers can rely on it unconditionally.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "x" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.creatures.generate({ name: "Frost Dragon", count: 1 })
    expect(result.jobIds).toEqual(["x"])
    expect(result.jobId).toBe("x")
  })

  it("generate returns the multi-candidate {jobIds} shape on count=4 (no jobId alias)", async () => {
    // Multi-candidate batches return `{ jobIds: string[] }` and intentionally
    // skip the `attachToCreatureId` auto-attach (the user must approve a
    // winner via approveMainImage). No deprecated `jobId` alias for count>1.
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ jobIds: ["j1", "j2", "j3", "j4"] }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.creatures.generate({ name: "Frost Dragon", count: 4 })
    expect(result.jobIds.length).toBe(4)
    expect(result.jobId).toBeUndefined()
  })

  it("generate threads seedPromptHint through to the body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.generate({
      name: "Frost Dragon",
      seedPromptHint: "armored frost dragon, jagged ice spines",
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.seedPromptHint).toBe("armored frost dragon, jagged ice spines")
  })

  it("generateAsset POSTs /v1/generate-creature-asset with the body (poses delta)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-2" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.generateAsset({
      assetType: "poses",
      variant: "walking",
      name: "Frost Dragon",
      attachToCreatureId: "uuid-1",
      attachToColumn: "poses",
      attachName: "walking",
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-creature-asset",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.assetType).toBe("poses")
    expect(body.variant).toBe("walking")
    expect(body.attachToColumn).toBe("poses")
    expect(body.attachToCreatureId).toBe("uuid-1")
  })

  it("generateAsset accepts the 3 canonical asset types + their attach columns", async () => {
    // assetType is the 4-value union (angles / poses / variations / custom),
    // with NO `motion` value (creature motion flows through the dedicated
    // motion endpoint). This exercises the 3 canonical buckets at the type
    // level (compile-time) AND verifies each lands on the wire correctly.
    const cases = [
      { assetType: "angles", column: "angles" },
      { assetType: "poses", column: "poses" },
      { assetType: "variations", column: "variations" },
    ] as const
    for (const { assetType, column } of cases) {
      const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: `job-${column}` }))
      const c = createClient({
        baseUrl: "https://api.example.com",
        auth: new StaticTokenAuth("t"),
        fetch: fetchMock,
      })
      await c.creatures.generateAsset({
        assetType,
        variant: "test",
        name: "Frost Dragon",
        attachToCreatureId: "uuid-1",
        attachToColumn: column,
        attachName: "test",
      })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.assetType).toBe(assetType)
      expect(body.attachToColumn).toBe(column)
    }
  })

  it("generateAsset accepts a custom asset type with explicit attachToColumn", async () => {
    // `custom` requires an explicit attachToColumn since the worker can't
    // infer the bucket from the asset type. motion_clips IS a valid attach
    // column even though it's not an asset type.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-custom" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.generateAsset({
      assetType: "custom",
      variant: "bioluminescent glow",
      name: "Frost Dragon",
      attachToCreatureId: "uuid-1",
      attachToColumn: "variations",
      attachName: "glow",
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.assetType).toBe("custom")
    expect(body.attachToColumn).toBe("variations")
  })

  it("generateMotion POSTs /v1/generate-creature-motion with the body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-1" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.creatures.generateMotion({
      motionPrompt: "slow prowl",
      sourceImageUrl: "https://example.com/main.jpg",
      name: "Frost Dragon",
    })
    expect(result.jobId).toBe("j-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/generate-creature-motion",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({
      motionPrompt: "slow prowl",
      sourceImageUrl: "https://example.com/main.jpg",
      name: "Frost Dragon",
    })
  })

  it("generateMotion threads attach + aspectRatio fields when set", async () => {
    // Studio auto-attach path: when attachToCreatureId + attachName are set
    // alongside aspectRatio, the worker appends `{ name: attachName, url:
    // <result> }` to the row's `motion_clips` column. The SDK passes
    // everything through unchanged. Creatures default to 1:1 server-side but
    // 4:3 / 16:9 / 9:16 are all valid overrides via the 5-value object enum.
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-2" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.generateMotion({
      motionPrompt: "circle-strafe around the dragon",
      sourceImageUrl: "https://r2/main.png",
      provider: "kling-turbo",
      name: "Frost Dragon",
      category: "mythical",
      style: "realistic",
      canonicalDescription: "An ice-scaled dragon, jagged frost spines...",
      attachToCreatureId: "uuid-1",
      attachName: "circle-strafe",
      aspectRatio: "16:9",
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.provider).toBe("kling-turbo")
    expect(body.attachToCreatureId).toBe("uuid-1")
    expect(body.attachName).toBe("circle-strafe")
    expect(body.aspectRatio).toBe("16:9")
    expect(body.style).toBe("realistic")
    expect(body.canonicalDescription).toBe("An ice-scaled dragon, jagged frost spines...")
  })

  it("approveMainImage POSTs /v1/creatures/:id/approve-main-image", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        sourceImageUrl: "https://r2/x.png",
        canonicalDescription: "An ice-scaled dragon...",
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.creatures.approveMainImage("uuid-1", "job-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/creatures/uuid-1/approve-main-image",
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.candidateJobId).toBe("job-1")
    expect(result.sourceImageUrl).toBe("https://r2/x.png")
    // A real caption passes through untouched.
    expect(result.canonicalDescription).toBe("An ice-scaled dragon...")
  })

  it("approveMainImage normalizes the wire \"\" caption → null (matches characters)", async () => {
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
    const result = await c.creatures.approveMainImage("uuid-1", "job-1")
    expect(result.sourceImageUrl).toBe("https://r2/x.png")
    expect(result.canonicalDescription).toBeNull()
  })

  it("get normalizes the wire \"\" caption → null", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "uuid-1", name: "Frost Dragon", canonicalDescription: "" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.creatures.get("uuid-1")
    expect(result.canonicalDescription).toBeNull()
    // Other fields pass through unchanged.
    expect(result.name).toBe("Frost Dragon")
  })

  it("get passes a real caption through unchanged", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "uuid-1", name: "Frost Dragon", canonicalDescription: "An ice-scaled dragon." }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.creatures.get("uuid-1")
    expect(result.canonicalDescription).toBe("An ice-scaled dragon.")
  })

  it("approveMainImage threads expectedUpdatedAt when supplied", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        sourceImageUrl: "https://r2/x.png",
        canonicalDescription: "An ice-scaled dragon...",
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.approveMainImage("uuid-1", "job-1", "2026-06-07T00:00:00.000Z")
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.candidateJobId).toBe("job-1")
    expect(body.expectedUpdatedAt).toBe("2026-06-07T00:00:00.000Z")
  })

  it("recaption POSTs /v1/creatures/:id/llm-caption with no body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ canonicalDescription: "fresh caption" }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.creatures.recaption("uuid-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/creatures/uuid-1/llm-caption",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    // recaption sends no body — the route reads only the :id param. This route
    // is a pure idempotent retry, so the SDK method takes only `id` (no
    // expectedUpdatedAt).
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
          message: "Failed to caption creature image",
        },
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.creatures.recaption("uuid-1")).rejects.toBeInstanceOf(NodaroError)
    await expect(c.creatures.recaption("uuid-1")).rejects.toMatchObject({
      code: "caption_failed",
      status: 502,
    })
  })

  it("update throws NotFoundError on 404 (uniform not_found)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Creature not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.creatures.update("missing", { name: "X" }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
