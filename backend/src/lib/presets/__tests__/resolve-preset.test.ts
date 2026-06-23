import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * vi.fn()-based supabase query mock (replaces the old self-returning-literal stub).
 *
 * Why this shape:
 *  - `maybeSingleResult` is a mutable holder so each test can return a custom row
 *    (or the default no-match) from `.maybeSingle()`.
 *  - Every chain method is a `vi.fn()` returning the same chain object `q`, so we can
 *    (a) spy on `.eq(...)` call args (the owner-scope security guard), and
 *    (b) assert `from` / `maybeSingle` call counts (proves the no-userId path never
 *        touches the DB).
 *
 * The holder + spies are declared via `vi.hoisted` so they survive `vi.mock` hoisting
 * and stay referenceable from the test body.
 */
const { q, maybeSingleResult } = vi.hoisted(() => {
  const maybeSingleResult: { current: { data: unknown; error: unknown } } = {
    current: { data: null, error: null }, // no custom match by default
  }
  const q: Record<string, ReturnType<typeof vi.fn>> = {}
  q.from = vi.fn(() => q)
  q.select = vi.fn(() => q)
  q.eq = vi.fn(() => q)
  q.maybeSingle = vi.fn(() => Promise.resolve(maybeSingleResult.current))
  return { q, maybeSingleResult }
})

vi.mock("../../supabase.js", () => ({ supabase: q }))

import { resolvePreset } from "../resolve-preset.js"

beforeEach(() => {
  // Reset call history + default the row to "no match" before each test so spy
  // assertions and the custom-HIT row never leak across tests.
  vi.clearAllMocks()
  maybeSingleResult.current = { data: null, error: null }
})

describe("resolvePreset", () => {
  it("resolves a factory preset by slug id and strips to config", async () => {
    const r = await resolvePreset({
      nodeType: "generate-image",
      presetId: "generate-image/location-board",
    })
    expect(r).toBeTruthy()
    expect(r!.source).toBe("factory")
    expect(typeof r!.data.provider).toBe("string") // real factory data carries provider/prompt
    expect(typeof r!.data.prompt).toBe("string")
    expect(r!.data.label).toBeUndefined() // stripped
    // Factory ids resolve without ever touching the DB.
    expect(q.from).toHaveBeenCalledTimes(0)
    expect(q.maybeSingle).toHaveBeenCalledTimes(0)
  })

  it("returns null for an unknown id", async () => {
    expect(
      await resolvePreset({ nodeType: "generate-image", presetId: "generate-image/nope" }),
    ).toBeNull()
  })

  // Shared custom-row fixture for the HIT + owner-scope cases.
  const CUSTOM_ID = "11111111-2222-3333-4444-555555555555"
  const seedCustomRow = () => {
    maybeSingleResult.current = {
      data: {
        id: CUSTOM_ID,
        node_type: "generate-image",
        name: "My Preset",
        description: null,
        data: { provider: "flux", prompt: "x", label: "junk" },
      },
      error: null,
    }
  }

  it("resolves a custom preset (DB hit), maps null→undefined, and strips runtime keys", async () => {
    seedCustomRow()

    const r = await resolvePreset({
      nodeType: "generate-image",
      presetId: CUSTOM_ID,
      userId: "u1",
    })

    expect(r).toBeTruthy()
    expect(r!.source).toBe("custom")
    expect(r!.id).toBe(CUSTOM_ID)
    expect(r!.name).toBe("My Preset")
    expect(r!.data.provider).toBe("flux")
    expect(r!.data.label).toBeUndefined() // stripped by extractPresetData
    expect(r!.description).toBeUndefined() // null → undefined
  })

  it("scopes the custom query by id + user_id + node_type (IDOR regression guard)", async () => {
    // SECURITY REGRESSION GUARD: the custom query MUST be owner-scoped on all three
    // filters. The supabase client uses the service-role key (RLS bypassed), so
    // `.eq("user_id", userId)` is the SOLE IDOR barrier — this assertion fails the
    // moment a future edit drops it (or the node_type / id scoping).
    seedCustomRow()

    await resolvePreset({ nodeType: "generate-image", presetId: CUSTOM_ID, userId: "u1" })

    const eqCalls = q.eq.mock.calls
    expect(eqCalls).toContainEqual(["id", CUSTOM_ID])
    expect(eqCalls).toContainEqual(["user_id", "u1"])
    expect(eqCalls).toContainEqual(["node_type", "generate-image"])
  })

  it("never queries the DB for a non-factory id when userId is absent", async () => {
    // No userId + non-factory (UUID) id → must short-circuit to null BEFORE any DB
    // access, so no cross-user fetch path can exist without an owner to scope it.
    const r = await resolvePreset({
      nodeType: "generate-image",
      presetId: "some-uuid",
    })
    expect(r).toBeNull()
    expect(q.from).toHaveBeenCalledTimes(0)
    expect(q.maybeSingle).toHaveBeenCalledTimes(0)
    expect(q.eq).toHaveBeenCalledTimes(0)
  })
})
