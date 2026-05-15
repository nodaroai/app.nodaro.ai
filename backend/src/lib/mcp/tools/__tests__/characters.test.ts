import { describe, it, expect, vi, beforeEach } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerCharacterTools } = await import("../characters.js")
const { supabase } = await import("../../../supabase.js")

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

const KIRA_ID = "11111111-1111-4111-8111-111111111111"
const SHIRA_ID = "22222222-2222-4222-8222-222222222222"
const OTHER_USER_CHAR_ID = "33333333-3333-4333-8333-333333333333"

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Chainable supabase stub. Every builder method returns `this`; `maybeSingle`
 * resolves `result`, and the builder itself is awaitable for the list path
 * (`select → eq → eq → is → order → limit` resolves the array).
 */
function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "order", "limit"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve)
  return obj
}

function readSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:read"] as Scope[],
    clientName: "Claude",
  })
}

// ── list_characters ─────────────────────────────────────────────────────────

describe("list_characters tool", () => {
  it("returns the caller's characters scoped by user_id with asset counts", async () => {
    const builder = chain({
      data: [
        {
          id: KIRA_ID,
          name: "Kira",
          description: "freckled redhead protagonist",
          canonical_description: "young woman with auburn hair and green eyes",
          source_image_url: "https://example.com/kira.png",
          seed_prompt: "kira portrait",
          gender: "female",
          style: "photoreal",
          base_outfit: "denim jacket",
          expressions: [
            { name: "smile", url: "https://example.com/kira-smile.png" },
            { name: "frown", url: "https://example.com/kira-frown.png" },
          ],
          poses: [{ name: "standing", url: "https://example.com/kira-stand.png" }],
          motions: [],
          angles: null,
          body_angles: [],
          lighting_variations: [],
          updated_at: "2026-05-10T00:00:00Z",
        },
        {
          id: SHIRA_ID,
          name: "Shira",
          description: null,
          canonical_description: null,
          source_image_url: "https://example.com/shira.png",
          seed_prompt: null,
          gender: null,
          style: null,
          base_outfit: null,
          expressions: [{ name: "laughing", url: "https://example.com/shira-laugh.png" }],
          poses: [],
          motions: [],
          angles: [],
          body_angles: [],
          lighting_variations: [],
          updated_at: "2026-05-09T00:00:00Z",
        },
      ],
      error: null,
    })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "list_characters", {})
    expect(result.isError).toBeUndefined()

    // Critical: the query was scoped to the caller's user_id and excluded archived.
    const eqMock = builder.eq as ReturnType<typeof vi.fn>
    expect(eqMock).toHaveBeenCalledWith("user_id", "u1")
    const isMock = builder.is as ReturnType<typeof vi.fn>
    expect(isMock).toHaveBeenCalledWith("deleted_at", null)

    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      data: Array<{
        id: string
        name: string
        portraitUrl: string
        canonicalDescription: string | null
        assetCounts: Record<string, number>
      }>
    }
    expect(payload.data).toHaveLength(2)
    expect(payload.data[0]).toMatchObject({
      id: KIRA_ID,
      name: "Kira",
      portraitUrl: "https://example.com/kira.png",
      canonicalDescription: "young woman with auburn hair and green eyes",
      assetCounts: {
        expressions: 2,
        poses: 1,
        motions: 0,
        angles: 0, // null array tolerated
        bodyAngles: 0,
        lightingVariations: 0,
      },
    })
    expect(payload.data[1]).toMatchObject({
      id: SHIRA_ID,
      name: "Shira",
      assetCounts: { expressions: 1, poses: 0 },
    })
  })

  it("respects the limit parameter", async () => {
    const builder = chain({ data: [], error: null })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "list_characters", { limit: 5 })
    expect(result.isError).toBeUndefined()

    const limitMock = builder.limit as ReturnType<typeof vi.fn>
    expect(limitMock).toHaveBeenCalledWith(5)
  })

  it("defaults to limit=50 when not supplied", async () => {
    const builder = chain({ data: [], error: null })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools(server, readSession())
    await callTool(server, "list_characters", {})

    const limitMock = builder.limit as ReturnType<typeof vi.fn>
    expect(limitMock).toHaveBeenCalledWith(50)
  })

  it("orders by updated_at desc", async () => {
    const builder = chain({ data: [], error: null })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools(server, readSession())
    await callTool(server, "list_characters", {})

    const orderMock = builder.order as ReturnType<typeof vi.fn>
    expect(orderMock).toHaveBeenCalledWith("updated_at", { ascending: false })
  })

  it("returns isError on supabase error", async () => {
    fromMock.mockReturnValue(
      chain({ data: null, error: { message: "boom" } }),
    )
    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "list_characters", {})
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("boom")
  })

  it("does NOT register without assets:read scope", async () => {
    const server = buildServer()
    registerCharacterTools(
      server,
      newSession({ userId: "u1", scopes: [] as Scope[], clientName: "Claude" }),
    )
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_characters")
    expect(tools.map((t) => t.name)).not.toContain("get_character")
  })
})

// ── get_character ───────────────────────────────────────────────────────────

describe("get_character tool", () => {
  it("returns full detail for an owned character", async () => {
    const builder = chain({
      data: {
        id: KIRA_ID,
        name: "Kira",
        description: "freckled redhead protagonist",
        canonical_description: "young woman with auburn hair",
        source_image_url: "https://example.com/kira.png",
        seed_prompt: "kira portrait",
        gender: "female",
        style: "photoreal",
        base_outfit: "denim jacket",
        expressions: [
          { name: "smile", url: "https://example.com/kira-smile.png" },
          { name: "frown", url: "https://example.com/kira-frown.png" },
        ],
        poses: [{ name: "standing", url: "https://example.com/kira-stand.png" }],
        motions: [{ name: "wave", url: "https://example.com/kira-wave.mp4" }],
        angles: [{ name: "profile-left", url: "https://example.com/kira-profile.png" }],
        body_angles: [],
        lighting_variations: [
          { name: "golden-hour", url: "https://example.com/kira-golden.png" },
        ],
        reference_photos: [
          { url: "https://example.com/ref1.jpg", kind: "frontFace" },
        ],
        real_life_refs_by_variant: {
          smile: ["https://example.com/laugh-ref.jpg"],
        },
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-05-10T00:00:00Z",
      },
      error: null,
    })
    fromMock.mockReturnValue(builder)

    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "get_character", { id: KIRA_ID })
    expect(result.isError).toBeUndefined()

    // Scoped by id + user_id + not archived.
    const eqMock = builder.eq as ReturnType<typeof vi.fn>
    expect(eqMock).toHaveBeenCalledWith("id", KIRA_ID)
    expect(eqMock).toHaveBeenCalledWith("user_id", "u1")
    const isMock = builder.is as ReturnType<typeof vi.fn>
    expect(isMock).toHaveBeenCalledWith("deleted_at", null)

    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      data: {
        id: string
        name: string
        portraitUrl: string
        expressions: Array<{ name: string; url: string }>
        poses: Array<{ name: string; url: string }>
        motions: Array<{ name: string; url: string }>
        angles: Array<{ name: string; url: string }>
        bodyAngles: Array<{ name: string; url: string }>
        lightingVariations: Array<{ name: string; url: string }>
        referencePhotos: Array<{ url: string; kind: string }>
        realLifeRefsByVariant: Record<string, string[]>
      }
    }
    expect(payload.data.id).toBe(KIRA_ID)
    expect(payload.data.name).toBe("Kira")
    expect(payload.data.portraitUrl).toBe("https://example.com/kira.png")
    expect(payload.data.expressions).toHaveLength(2)
    expect(payload.data.expressions[0]).toEqual({
      name: "smile",
      url: "https://example.com/kira-smile.png",
    })
    expect(payload.data.poses).toHaveLength(1)
    expect(payload.data.motions).toHaveLength(1)
    expect(payload.data.angles).toHaveLength(1)
    expect(payload.data.bodyAngles).toEqual([])
    expect(payload.data.lightingVariations).toHaveLength(1)
    expect(payload.data.referencePhotos).toHaveLength(1)
    expect(payload.data.realLifeRefsByVariant).toEqual({
      smile: ["https://example.com/laugh-ref.jpg"],
    })
  })

  it("returns isError 'not found' for unknown id", async () => {
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "get_character", { id: SHIRA_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("not found")
  })

  it("returns isError 'not found' for a character owned by another user (manual scope)", async () => {
    // The DB returns null because the eq("user_id", "u1") filter excluded the
    // row. From the caller's perspective: indistinguishable from non-existence.
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "get_character", { id: OTHER_USER_CHAR_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("not found")
  })

  it("returns isError on supabase error", async () => {
    fromMock.mockReturnValue(
      chain({ data: null, error: { message: "db down" } }),
    )
    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "get_character", { id: KIRA_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("db down")
  })

  it("tolerates null asset arrays in the DB row", async () => {
    fromMock.mockReturnValue(
      chain({
        data: {
          id: KIRA_ID,
          name: "Kira",
          description: null,
          canonical_description: null,
          source_image_url: null,
          seed_prompt: null,
          gender: null,
          style: null,
          base_outfit: null,
          expressions: null,
          poses: null,
          motions: null,
          angles: null,
          body_angles: null,
          lighting_variations: null,
          reference_photos: null,
          real_life_refs_by_variant: null,
          created_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-05-10T00:00:00Z",
        },
        error: null,
      }),
    )
    const server = buildServer()
    registerCharacterTools(server, readSession())
    const result = await callTool(server, "get_character", { id: KIRA_ID })
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      data: Record<string, unknown>
    }
    expect(payload.data.expressions).toEqual([])
    expect(payload.data.poses).toEqual([])
    expect(payload.data.referencePhotos).toEqual([])
    expect(payload.data.realLifeRefsByVariant).toEqual({})
  })
})
