import { describe, it, expect, vi, beforeEach } from "vitest"
import React from "react"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { HeygenAvatar } from "@/lib/api"

const mockAvatarCatalog = vi.fn()
vi.mock("@/lib/api", () => ({
  getHeygenAvatarCatalog: (...args: unknown[]) => mockAvatarCatalog(...args),
  getHeygenVoiceCatalog: vi.fn(async () => ({ items: [], complete: true })),
}))

import {
  catalogRefetchInterval,
  mergeCatalogPage,
  useHeygenAvatars,
  avatarSelectionPatch,
  keylessCatalogHint,
} from "../heygen-catalog"
import type { HeygenCatalogPage } from "@/lib/api"

/** A server answer (whole or delta). */
const answer = <T,>(items: T[], over: Partial<HeygenCatalogPage<T>> = {}): HeygenCatalogPage<T> => ({
  items, offset: 0, total: items.length, complete: true, generation: "g1", ...over,
})

const look = (id: string): HeygenAvatar => ({ avatarId: id, name: id, gender: "female", previewImageUrl: `https://cdn/${id}.jpg` })

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => mockAvatarCatalog.mockReset())

// The catalog streams in: the server answers with what it has + `complete`.
// One polling rule for both catalogs, so a cold server fill is followed
// closely and a whole list stops the polling.
describe("catalogRefetchInterval", () => {
  it("polls every 2s while the server is still filling and pages are in hand", () => {
    expect(catalogRefetchInterval({ items: [look("a")], complete: false, generation: "g1" })).toBe(2_000)
  })
  it("polls slowly (15s) while nothing has arrived — keyless install OR a fill with no page yet", () => {
    expect(catalogRefetchInterval({ items: [], complete: true, generation: "none" })).toBe(15_000)
    expect(catalogRefetchInterval({ items: [], complete: false, generation: "g1" })).toBe(15_000)
  })
  it("stops once the list is whole", () => {
    expect(catalogRefetchInterval({ items: [look("a")], complete: true, generation: "g1" })).toBe(false)
    expect(catalogRefetchInterval(undefined)).toBe(false)
  })
})

// The wire is DELTA-shaped: the query keeps what it has and asks for the rest.
describe("mergeCatalogPage", () => {
  it("appends a delta of the same generation at exactly our offset", () => {
    const prev = { items: [look("a"), look("b")], complete: false, generation: "g1" }
    const next = mergeCatalogPage(prev, answer([look("c")], { offset: 2, total: 3, complete: false }))
    expect(next.items.map((a) => a.avatarId)).toEqual(["a", "b", "c"])
    expect(next).toMatchObject({ complete: false, generation: "g1" })
  })
  it("an empty delta that says complete just closes the list", () => {
    const prev = { items: [look("a")], complete: false, generation: "g1" }
    expect(mergeCatalogPage(prev, answer([], { offset: 1, total: 1 }))).toEqual({ items: [look("a")], complete: true, generation: "g1" })
  })
  it("a new generation (server refresh / restart) replaces the list from zero — never splices two fills", () => {
    const prev = { items: [look("a"), look("b")], complete: true, generation: "g1" }
    const next = mergeCatalogPage(prev, answer([look("z")], { generation: "g2" }))
    expect(next.items.map((a) => a.avatarId)).toEqual(["z"])
    expect(next.generation).toBe("g2")
  })
  it("an answer at an unexpected offset replaces rather than appends", () => {
    const prev = { items: [look("a"), look("b")], complete: false, generation: "g1" }
    expect(mergeCatalogPage(prev, answer([look("a"), look("b"), look("c")], { offset: 0, total: 3, complete: false })).items).toHaveLength(3)
  })
  it("a server that predates deltas (no generation) is taken as a whole list every time", () => {
    const prev = { items: [look("a")], complete: false, generation: "" }
    expect(mergeCatalogPage(prev, answer([look("a"), look("b")], { generation: "" })).items).toHaveLength(2)
    expect(mergeCatalogPage(undefined, answer([look("a")])).items).toHaveLength(1)
  })
})

describe("useHeygenAvatars", () => {
  it("exposes the items so far, `complete`, and a stable empty array before the first answer", async () => {
    mockAvatarCatalog.mockResolvedValue(answer([look("a"), look("b")], { complete: false }))
    const { result } = renderHook(() => useHeygenAvatars(), { wrapper })
    expect(result.current.data).toEqual([])
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.data).toHaveLength(2))
    expect(result.current.complete).toBe(false)
    expect(result.current.isLoading).toBe(false)
  })

  it("polls with the previous { offset, generation } and appends the delta it gets back", async () => {
    mockAvatarCatalog
      .mockResolvedValueOnce(answer([look("a"), look("b")], { complete: false }))
      .mockResolvedValueOnce(answer([look("c")], { offset: 2, total: 3, complete: true }))
    const { result } = renderHook(() => useHeygenAvatars(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(2))
    // the 2s filling poll fires → asks from where we are, in our generation
    await waitFor(() => expect(mockAvatarCatalog).toHaveBeenCalledTimes(2), { timeout: 4_000 })
    expect(mockAvatarCatalog).toHaveBeenLastCalledWith({ offset: 2, generation: "g1" })
    await waitFor(() => expect(result.current.data).toHaveLength(3))
    expect(result.current.data.map((a) => a.avatarId)).toEqual(["a", "b", "c"])
    expect(result.current.complete).toBe(true)
  })

  it("an empty answer that is NOT complete still reads as loading — never as 'no avatars'", async () => {
    mockAvatarCatalog.mockResolvedValue(answer([], { complete: false }))
    const { result } = renderHook(() => useHeygenAvatars(), { wrapper })
    await waitFor(() => expect(mockAvatarCatalog).toHaveBeenCalled())
    await waitFor(() => expect(result.current.complete).toBe(false))
    expect(result.current.data).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it("an empty COMPLETE answer (keyless install) is not loading", async () => {
    mockAvatarCatalog.mockResolvedValue(answer([], { generation: "none" }))
    const { result } = renderHook(() => useHeygenAvatars(), { wrapper })
    await waitFor(() => expect(result.current.complete).toBe(true))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toEqual([])
  })
})

describe("avatarSelectionPatch / keylessCatalogHint", () => {
  it("writes the same fields the settings panel writes", () => {
    const a: HeygenAvatar = {
      ...look("x1"), groupId: "g", defaultVoiceId: "dv", preferredOrientation: "portrait", supportedEngines: ["avatar_iv"],
    }
    expect(avatarSelectionPatch(a, undefined)).toEqual({
      avatarId: "x1", avatarName: "x1", avatarPreviewUrl: "https://cdn/x1.jpg", avatarGroupId: "g",
      avatarSupportsV: false, voiceId: "dv", aspectRatio: "9:16",
    })
    // an already-picked voice is kept; missing engine metadata → undefined (no warning on a guess)
    expect(avatarSelectionPatch({ ...look("x2") }, "mine")).toMatchObject({ voiceId: "mine", avatarSupportsV: undefined, aspectRatio: "16:9" })
  })
  it("the keyless copy is one string for every surface", () => {
    expect(keylessCatalogHint("avatars")).toBe("Add a HeyGen key or connect nodaro.ai under Integrations → Model providers to browse avatars.")
    expect(keylessCatalogHint("voices")).toBe("Add a HeyGen key or connect nodaro.ai under Integrations → Model providers to browse voices.")
  })
})
