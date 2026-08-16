import { describe, it, expect, vi, beforeEach } from "vitest"
import React from "react"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { HeygenAvatar } from "@/lib/api"

const mockAvatarCatalog = vi.fn()
const mockPrivateAvatars = vi.fn(async () => [] as HeygenAvatar[])
vi.mock("@/lib/api", () => ({
  getHeygenAvatarCatalog: (...args: unknown[]) => mockAvatarCatalog(...args),
  getHeygenPrivateAvatars: (...args: unknown[]) => mockPrivateAvatars(...(args as [])),
  getHeygenVoiceCatalog: vi.fn(async () => ({ items: [], offset: 0, total: 0, complete: true, generation: "g1" })),
}))

import {
  catalogRefetchInterval,
  mergeCatalogPage,
  mergeOwnAndPresetAvatars,
  filterAvatars,
  hasGroupSegmentation,
  useHeygenAvatars,
  avatarSelectionPatch,
  keylessCatalogHint,
  CATALOG_CHUNK_SIZE,
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

beforeEach(() => {
  mockAvatarCatalog.mockReset()
  mockPrivateAvatars.mockReset()
  mockPrivateAvatars.mockResolvedValue([])
})

// The catalog streams in: the server answers with what it has + `complete`.
// One polling rule for both catalogs, so a cold server fill is followed
// closely and a whole list stops the polling.
describe("catalogRefetchInterval", () => {
  it("polls every 2s while the server is still filling and pages are in hand", () => {
    expect(catalogRefetchInterval({ items: [look("a")], complete: false, total: 1, generation: "g1", flips: 0 })).toBe(2_000)
  })
  it("polls slowly (15s) on a keyless install; every 2s when a fill has not produced a page yet", () => {
    expect(catalogRefetchInterval({ items: [], complete: true, total: 0, generation: "none", flips: 0 })).toBe(15_000)
    expect(catalogRefetchInterval({ items: [], complete: false, total: 0, generation: "g1", flips: 0 })).toBe(2_000)
  })
  it("pulls the next chunk straight away while behind a whole list", () => {
    expect(catalogRefetchInterval({ items: [look("a")], complete: true, total: 3, generation: "g1", flips: 0 })).toBe(50)
  })
  it("stops once the list is whole and we are caught up", () => {
    expect(catalogRefetchInterval({ items: [look("a")], complete: true, total: 1, generation: "g1", flips: 0 })).toBe(false)
    expect(catalogRefetchInterval(undefined)).toBe(false)
  })
})

// The wire is DELTA-shaped: the query keeps what it has and asks for the rest.
describe("mergeCatalogPage", () => {
  it("appends a delta of the same generation at exactly our offset", () => {
    const prev = { items: [look("a"), look("b")], complete: false, total: 2, generation: "g1", flips: 0 }
    const next = mergeCatalogPage(prev, answer([look("c")], { offset: 2, total: 3, complete: false }))
    expect(next.items.map((a) => a.avatarId)).toEqual(["a", "b", "c"])
    expect(next).toMatchObject({ complete: false, total: 3, generation: "g1", flips: 0 })
  })
  it("an empty delta that says complete just closes the list", () => {
    const prev = { items: [look("a")], complete: false, total: 1, generation: "g1", flips: 0 }
    expect(mergeCatalogPage(prev, answer([], { offset: 1, total: 1 }))).toEqual({ items: [look("a")], complete: true, total: 1, generation: "g1", flips: 0 })
  })
  it("a chunk of a whole list appends and keeps total (so the client knows it is behind)", () => {
    const prev = { items: [look("a")], complete: true, total: 3, generation: "g1", flips: 0 }
    const next = mergeCatalogPage(prev, answer([look("b")], { offset: 1, total: 3 }))
    expect(next).toMatchObject({ complete: true, total: 3 })
    expect(next.items.map((a) => a.avatarId)).toEqual(["a", "b"])
  })
  it("a new generation (server refresh / restart) replaces the list from zero — never splices two fills", () => {
    const prev = { items: [look("a"), look("b")], complete: true, total: 2, generation: "g1", flips: 0 }
    const next = mergeCatalogPage(prev, answer([look("z")], { generation: "g2" }))
    expect(next.items.map((a) => a.avatarId)).toEqual(["z"])
    expect(next.generation).toBe("g2")
  })
  it("an answer at an unexpected offset replaces rather than appends", () => {
    const prev = { items: [look("a"), look("b")], complete: false, total: 2, generation: "g1", flips: 0 }
    expect(mergeCatalogPage(prev, answer([look("a"), look("b"), look("c")], { offset: 0, total: 3, complete: false })).items).toHaveLength(3)
  })
  it("a server that predates deltas (no generation) is taken as a whole list every time", () => {
    const prev = { items: [look("a")], complete: false, total: 1, generation: "", flips: 0 }
    expect(mergeCatalogPage(prev, answer([look("a"), look("b")], { generation: "" })).items).toHaveLength(2)
    expect(mergeCatalogPage(undefined, answer([look("a")])).items).toHaveLength(1)
  })
})

describe("generation flips — replicas that disagree", () => {
  it("counts consecutive replacements while behind, keeps the count across appends, and clears it once caught up", () => {
    const g1 = mergeCatalogPage(undefined, answer([look("a")], { offset: 0, total: 3, generation: "g1" }))
    expect(g1.flips).toBe(0)
    const flipped = mergeCatalogPage(g1, answer([look("x")], { offset: 0, total: 3, generation: "g2" })) // a sibling replica answered
    expect(flipped.flips).toBe(1)
    const appended = mergeCatalogPage(flipped, answer([look("y")], { offset: 1, total: 3, generation: "g2" }))
    expect(appended.flips).toBe(1)
    const flippedAgain = mergeCatalogPage(appended, answer([look("a")], { offset: 0, total: 3, generation: "g1" }))
    expect(flippedAgain.flips).toBe(2)
    const whole = mergeCatalogPage(flippedAgain, answer([look("a"), look("b"), look("c")], { offset: 0, total: 3, generation: "g1" }))
    expect(whole.flips).toBe(0)
    expect(whole.items).toHaveLength(3)
  })
})

describe("mergeOwnAndPresetAvatars", () => {
  it("lists the account's own looks first and never shows a look twice (the private row wins)", () => {
    const own = [{ ...look("mine"), ownership: "private" as const }, { ...look("dup"), ownership: "private" as const, name: "fresh name" }]
    const presets = [look("a"), { ...look("dup"), name: "stale name" }, look("b")]
    const merged = mergeOwnAndPresetAvatars(own, presets)
    expect(merged.map((a) => a.avatarId)).toEqual(["mine", "dup", "a", "b"])
    expect(merged[1].name).toBe("fresh name")
  })
  it("with no private looks, hands the presets back as-is (same array — no re-render churn)", () => {
    const presets = [look("a")]
    expect(mergeOwnAndPresetAvatars([], presets)).toBe(presets)
  })
})

describe("Stock / Custom — ownership-aware, with the old heuristic only for servers that predate it", () => {
  const preset = { ...look("p"), groupId: "g-preset", ownership: "public" as const }
  const own = { ...look("m"), groupId: "g-mine", ownership: "private" as const }
  it("uses ownership when the catalog carries it (every real preset has a group_id too, so groupId alone was wrong)", () => {
    expect(hasGroupSegmentation([preset])).toBe(false)
    expect(hasGroupSegmentation([preset, own])).toBe(true)
    expect(filterAvatars([preset, own], "", "all", "stock").map((a) => a.avatarId)).toEqual(["p"])
    expect(filterAvatars([preset, own], "", "all", "custom").map((a) => a.avatarId)).toEqual(["m"])
  })
  it("falls back to the groupId heuristic when no look carries ownership (older server)", () => {
    const legacyPreset = look("lp")
    const legacyCustom = { ...look("lc"), groupId: "g" }
    expect(hasGroupSegmentation([legacyPreset])).toBe(false)
    expect(hasGroupSegmentation([legacyPreset, legacyCustom])).toBe(true)
    expect(filterAvatars([legacyPreset, legacyCustom], "", "all", "custom").map((a) => a.avatarId)).toEqual(["lc"])
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

  it("asks for chunks of a warm list, publishing each into the cache, until it is caught up", async () => {
    // A whole list of 4 the server hands out at most 2 at a time (a smaller
    // cap than the client asks for — the server's answer size is its call).
    const all = [look("a"), look("b"), look("c"), look("d")]
    mockAvatarCatalog.mockImplementation(async (since?: { offset: number }, limit?: number) => {
      const offset = since?.offset ?? 0
      return answer(all.slice(offset, offset + Math.min(2, limit ?? 2)), { offset, total: all.length })
    })
    const { result } = renderHook(() => useHeygenAvatars(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(4))
    expect(result.current.complete).toBe(true)
    // first call: from zero, chunk-sized; then from where we were
    expect(mockAvatarCatalog.mock.calls[0].slice(0, 2)).toEqual([undefined, CATALOG_CHUNK_SIZE])
    expect(mockAvatarCatalog.mock.calls[0][2]).toBeInstanceOf(AbortSignal)
    expect(mockAvatarCatalog.mock.calls[1]?.[0]).toEqual({ offset: 2, generation: "g1" })
  })

  it("when replicas keep answering with different generations, gives up chunking and asks for the whole list once", async () => {
    // Two "replicas" that never agree, each holding a 3-item list served 2 at a time.
    const lists: Record<string, ReturnType<typeof look>[]> = { gA: [look("a1"), look("a2"), look("a3")], gB: [look("b1"), look("b2"), look("b3")] }
    let turn = 0
    mockAvatarCatalog.mockImplementation(async (since?: { offset: number; generation: string }, limit?: number) => {
      const gen = turn++ % 2 === 0 ? "gA" : "gB"
      const all = lists[gen]
      const offset = since?.generation === gen ? since.offset : 0
      const end = limit ? Math.min(all.length, offset + Math.min(2, limit)) : all.length
      return answer(all.slice(offset, end), { offset, total: all.length, generation: gen })
    })
    const { result } = renderHook(() => useHeygenAvatars(), { wrapper })
    await waitFor(() => expect(result.current.complete).toBe(true), { timeout: 5_000 })
    expect(result.current.data).toHaveLength(3)
    // The run that converged asked for everything: no since, no limit.
    const wholeCalls = mockAvatarCatalog.mock.calls.filter((c) => c[0] === undefined && c[1] === undefined)
    expect(wholeCalls.length).toBeGreaterThanOrEqual(1)
    // and it did not spin: a bounded handful of requests, not dozens
    expect(mockAvatarCatalog.mock.calls.length).toBeLessThan(8)
  })

  it("puts the account's own looks first, deduped against the presets", async () => {
    mockAvatarCatalog.mockResolvedValue(answer([look("a"), look("mine")]))
    mockPrivateAvatars.mockResolvedValue([{ ...look("mine"), ownership: "private" }])
    const { result } = renderHook(() => useHeygenAvatars(), { wrapper })
    await waitFor(() => expect(result.current.data.map((a) => a.avatarId)).toEqual(["mine", "a"]))
    expect(result.current.data[0].ownership).toBe("private")
  })

  it("polls with the previous { offset, generation } and appends the delta it gets back", async () => {
    mockAvatarCatalog
      .mockResolvedValueOnce(answer([look("a"), look("b")], { complete: false }))
      .mockResolvedValueOnce(answer([look("c")], { offset: 2, total: 3, complete: true }))
    const { result } = renderHook(() => useHeygenAvatars(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(2))
    // the 2s filling poll fires → asks from where we are, in our generation
    await waitFor(() => expect(mockAvatarCatalog).toHaveBeenCalledTimes(2), { timeout: 4_000 })
    expect(mockAvatarCatalog).toHaveBeenLastCalledWith({ offset: 2, generation: "g1" }, CATALOG_CHUNK_SIZE, expect.any(AbortSignal))
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
