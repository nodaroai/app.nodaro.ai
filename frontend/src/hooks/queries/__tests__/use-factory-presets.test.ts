import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The preset menu's factory catalog is read from the server (the deployment's
 * presets included), under a key of its own: a change to the user's own
 * presets invalidates `nodePresets.all`, which must not refetch the catalog.
 */

const captured = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock("@tanstack/react-query", () => ({
  useMutation: vi.fn(),
  useQuery: (opts: Record<string, unknown>) => {
    captured.push(opts)
    return opts
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}))

const { useFactoryPresets } = await import("../use-node-presets-queries")
const { queryKeys } = await import("@/lib/query-keys")
const { listFactoryNodePresets } = await import("@/lib/api")

beforeEach(() => {
  captured.length = 0
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useFactoryPresets", () => {
  it("reads the node type's catalog under its own key, outside the user's presets", () => {
    useFactoryPresets("generate-image")
    const [opts] = captured
    expect(opts.queryKey).toEqual(["nodePresetFactory", "list", "generate-image"])
    expect((opts.queryKey as readonly string[])[0]).not.toBe(queryKeys.nodePresets.all[0])
    expect(opts.enabled).toBe(true)
  })

  it("asks for nothing without a node type", () => {
    useFactoryPresets(undefined)
    expect(captured[0]?.enabled).toBe(false)
  })
})

describe("listFactoryNodePresets", () => {
  it("asks the factory route for the node type and returns the entries it can show", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "generate-image/a", name: "A", data: { prompt: "p" }, previewUrl: null }] }), { status: 200 }))
    vi.stubGlobal("fetch", fetch)
    await expect(listFactoryNodePresets("generate-image")).resolves.toEqual([{ id: "generate-image/a", name: "A", data: { prompt: "p" } }])
    expect(fetch).toHaveBeenCalledWith("/v1/node-presets/factory?nodeType=generate-image", expect.objectContaining({ method: "GET" }))
  })

  it("fails on an error answer, so the menu keeps the bundled catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "internal_error", message: "boom" } }), { status: 500 })))
    await expect(listFactoryNodePresets("generate-image")).rejects.toThrow()
  })
})
