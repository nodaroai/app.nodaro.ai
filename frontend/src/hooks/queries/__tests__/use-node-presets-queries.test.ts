import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Deleting a preset that is already gone — another tab, another device, or an
 * API client deleted it first — answers 404 now (the route no longer reports a
 * delete it did not make). For the editor that is the state the click asked
 * for, so the mutation resolves and the list refreshes, as folders do (#722).
 */

const captured = vi.hoisted(() => [] as Array<{ mutationFn: (arg: unknown) => Promise<unknown> }>)

vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: { mutationFn: (arg: unknown) => Promise<unknown> }) => {
    captured.push(opts)
    return opts
  },
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

const api = vi.hoisted(() => ({ deleteNodePreset: vi.fn(), deleteNodePresetGroup: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  deleteNodePreset: (id: string) => api.deleteNodePreset(id),
  deleteNodePresetGroup: (id: string) => api.deleteNodePresetGroup(id),
}))

const { useNodePresetMutations } = await import("../use-node-presets-queries")

function notFound(): Error {
  return Object.assign(new Error("Preset not found."), { code: "not_found" })
}

beforeEach(() => {
  captured.length = 0
  api.deleteNodePreset.mockReset()
})

describe("useNodePresetMutations().remove", () => {
  it("treats a preset that is already gone (404 not_found) as deleted", async () => {
    api.deleteNodePreset.mockRejectedValue(notFound())
    const { remove } = useNodePresetMutations() as unknown as { remove: { mutationFn: (id: string) => Promise<unknown> } }
    await expect(remove.mutationFn("p1")).resolves.toBeUndefined()
    expect(api.deleteNodePreset).toHaveBeenCalledWith("p1")
  })

  it("still fails on any other error", async () => {
    api.deleteNodePreset.mockRejectedValue(Object.assign(new Error("boom"), { code: "internal_error" }))
    const { remove } = useNodePresetMutations() as unknown as { remove: { mutationFn: (id: string) => Promise<unknown> } }
    await expect(remove.mutationFn("p1")).rejects.toThrow("boom")
  })
})
