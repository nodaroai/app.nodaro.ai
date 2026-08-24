/**
 * The read pair objects and creatures never had.
 *
 * Both kinds shipped with action tools that take an entity id — recaption it,
 * approve its main image, animate it — and nothing anywhere that could produce
 * one. This suite covers the three properties that make the new pair safe to
 * hand a model: it can only see the caller's own rows, a name search cannot
 * escape the filter grammar, and a LIST does not spray media URLs into a
 * context window with a 24k cap.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

vi.mock("../../../config.js", () => ({
  config: { INTERNAL_ORCHESTRATOR_SECRET: "test-secret", PUBLIC_URL: "" },
  hasCredits: () => true,
  hasAdmin: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
}))

const { registerObjectTools } = await import("../objects.js")
const { registerCreatureTools } = await import("../creatures.js")
const { supabase } = await import("../../../supabase.js")

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>
const SWORD_ID = "11111111-1111-4111-8111-111111111111"

/** Records every builder call so the test can assert the FILTER, not the result. */
function chain(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = []
  const obj: Record<string, unknown> = { calls }
  for (const m of ["select", "eq", "is", "ilike", "order", "limit"]) {
    obj[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, args])
      return obj
    })
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

function readSession() {
  return newSession({ userId: "u1", scopes: ["assets:read"] as Scope[], clientName: "Claude" })
}

function objectServer(session = readSession()) {
  const server = buildServer()
  registerObjectTools({ server, session })
  return server
}

function creatureServer(session = readSession()) {
  const server = buildServer()
  registerCreatureTools({ server, session })
  return server
}

/** listTools returns definitions; these tests care about the names. */
async function toolNames(server: ReturnType<typeof objectServer>) {
  return (await listTools(server)).map((t) => t.name)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("entity read tools", () => {
  it("registers a list and a get for both kinds", async () => {
    const objects = await toolNames(objectServer())
    expect(objects).toContain("list_objects")
    expect(objects).toContain("get_object")

    const creatures = await toolNames(creatureServer())
    expect(creatures).toContain("list_creatures")
    expect(creatures).toContain("get_creature")
  })

  it("registers nothing without assets:read", async () => {
    const tools = await toolNames(
      objectServer(newSession({ userId: "u1", scopes: ["jobs:read"] as Scope[], clientName: "Claude" })),
    )
    expect(tools).not.toContain("list_objects")
    expect(tools).not.toContain("get_object")
  })

  it("scopes the list to the caller's own live rows", async () => {
    const builder = chain({ data: [], error: null })
    fromMock.mockReturnValue(builder)

    await callTool(objectServer(), "list_objects", {})

    const calls = builder.calls as Array<[string, unknown[]]>
    expect(fromMock).toHaveBeenCalledWith("objects")
    // Applied to the QUERY, not checked after the fetch — a row that is not
    // the caller's must come back as zero rows, so "not yours" and "no such
    // row" are the same answer and neither can be used to probe for ids.
    expect(calls).toContainEqual(["eq", ["user_id", "u1"]])
    expect(calls).toContainEqual(["is", ["deleted_at", null]])
  })

  it("scopes a get by id the same way", async () => {
    const builder = chain({ data: null, error: null })
    fromMock.mockReturnValue(builder)

    const res = await callTool(objectServer(), "get_object", { id: SWORD_ID })

    const calls = builder.calls as Array<[string, unknown[]]>
    expect(calls).toContainEqual(["eq", ["id", SWORD_ID]])
    expect(calls).toContainEqual(["eq", ["user_id", "u1"]])
    expect(res.isError).toBe(true)
    // Same wording a genuinely missing row gets.
    expect(JSON.stringify(res)).toContain("not found")
  })

  it("escapes a name search rather than passing it into the filter grammar", async () => {
    const builder = chain({ data: [], error: null })
    fromMock.mockReturnValue(builder)

    await callTool(objectServer(), "list_objects", { search: "50%_off,(x)" })

    const ilike = (builder.calls as Array<[string, unknown[]]>).find(([m]) => m === "ilike")
    expect(ilike).toBeDefined()
    const pattern = String(ilike![1][1])
    // `%` and `_` are ILIKE wildcards; `,` and `()` are PostgREST's own
    // grammar. Neither may survive verbatim into the filter.
    expect(pattern).toContain("50\\%\\_off")
    expect(pattern).not.toContain(",")
    expect(pattern).not.toContain("(")
  })

  it("summarizes a list as COUNTS, never as a wall of media URLs", async () => {
    // The reason this does not just proxy `GET /v1/objects`: one row there
    // carries dozens of R2 addresses, and a model asking "what props do I
    // have?" would spend its whole tool-result budget on them.
    fromMock.mockReturnValue(
      chain({
        data: [
          {
            id: SWORD_ID,
            name: "Sword",
            description: "a blade",
            source_image_url: "https://r2.test/sword.png",
            angles: [{ name: "side", url: "https://r2.test/a1.png" }],
            materials: [{ name: "steel", url: "https://r2.test/m1.png" }],
            updated_at: "2026-08-24T00:00:00Z",
          },
        ],
        error: null,
      }),
    )

    const res = await callTool(objectServer(), "list_objects", {})
    const text = JSON.stringify(res)

    expect(text).toContain("Sword")
    expect(text).toContain("https://r2.test/sword.png") // the one identifying image
    expect(text).not.toContain("a1.png") // variant urls stay behind get_object
    expect(text).not.toContain("m1.png")
    expect(text).toContain("assetCounts")
  })

  it("never hands back the owner id or the tombstone", async () => {
    fromMock.mockReturnValue(
      chain({
        data: { id: SWORD_ID, name: "Sword", user_id: "u1", deleted_at: null, updated_at: "x" },
        error: null,
      }),
    )

    const res = await callTool(objectServer(), "get_object", { id: SWORD_ID })
    const text = JSON.stringify(res)

    expect(text).toContain("Sword")
    expect(text).not.toContain("user_id")
    expect(text).not.toContain("userId")
    expect(text).not.toContain("deletedAt")
  })
})
