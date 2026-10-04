import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseMutation = vi.fn()
const mockUseInfiniteQuery = vi.fn()
const mockGetAuthHeaders = vi.fn()
const mockFetch = vi.fn()
const queryClient = {
  cancelQueries: vi.fn(async () => undefined),
  getQueriesData: vi.fn(() => [] as unknown[]),
  setQueriesData: vi.fn(),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
}

vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: unknown) => mockUseMutation(opts),
  useInfiniteQuery: (opts: unknown) => mockUseInfiniteQuery(opts),
  useQuery: vi.fn(),
  useQueryClient: () => queryClient,
}))
vi.mock("@/lib/api", () => ({ getAuthHeaders: () => mockGetAuthHeaders() }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null, isAdmin: false }) }))
vi.mock("@/lib/edition", () => ({ hasAdmin: () => true }))
vi.mock("@/lib/query-keys", () => ({
  queryKeys: { gallery: { all: ["gallery"], list: (filter: string) => ["gallery", "list", filter] } },
}))

import {
  GalleryAdminError,
  galleryAdminRequest,
  useBlockGalleryCreatorsMutation,
  useBulkRemoveGalleryItemsMutation,
} from "../use-gallery-admin-queries"
import { useGalleryInfinite } from "../use-gallery-queries"

type MutationOptions = {
  mutationFn: (vars: unknown) => Promise<unknown>
  onMutate: (vars: unknown) => Promise<unknown>
}

function captureMutation(hook: () => unknown): MutationOptions {
  let captured: MutationOptions | undefined
  mockUseMutation.mockImplementation((opts: MutationOptions) => {
    captured = opts
    return {}
  })
  hook()
  return captured!
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ removed: 2 }) })
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

describe("galleryAdminRequest", () => {
  it("sends JSON with the admin's auth", async () => {
    await galleryAdminRequest("/v1/x", { method: "POST", body: { a: 1 } })
    expect(mockFetch).toHaveBeenCalledWith("/v1/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
      body: JSON.stringify({ a: 1 }),
    })
  })

  it("throws the server's code and message", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: "too_many_words", message: "full" } }) })
    const error = await galleryAdminRequest("/v1/x", { method: "POST" }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GalleryAdminError)
    expect((error as GalleryAdminError).code).toBe("too_many_words")
  })

  it("survives a body that is not JSON", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502, json: async () => Promise.reject(new Error("html")) })
    const error = await galleryAdminRequest("/v1/x", { method: "GET" }).catch((e: unknown) => e)
    expect((error as GalleryAdminError).code).toBeNull()
  })
})

describe("bulk removal and blocking", () => {
  it("removal posts the item ids to the bulk route and drops them from the lists at once", async () => {
    const opts = captureMutation(useBulkRemoveGalleryItemsMutation)
    await opts.mutationFn({ itemIds: ["a", "b"] })
    expect(mockFetch.mock.calls[0]![0]).toBe("/v1/gallery/remove")
    expect(JSON.parse(mockFetch.mock.calls[0]![1].body)).toEqual({ jobIds: ["a", "b"] })

    await opts.onMutate({ itemIds: ["a"] })
    const [filter, update] = queryClient.setQueriesData.mock.calls[0] as unknown as [unknown, (data: unknown) => { pages: { data: { id: string }[] }[] }]
    expect(filter).toEqual({ queryKey: ["gallery", "list"] })
    const next = update({ pages: [{ data: [{ id: "a" }, { id: "c" }], nextCursor: null }], pageParams: [undefined] })
    expect(next.pages[0]!.data.map((item) => item.id)).toEqual(["c"])
  })

  it("blocking posts the item ids to the creators route", async () => {
    const opts = captureMutation(useBlockGalleryCreatorsMutation)
    await opts.mutationFn({ itemIds: ["a"] })
    expect(mockFetch.mock.calls[0]![0]).toBe("/v1/admin/gallery-moderation/creators")
    expect(JSON.parse(mockFetch.mock.calls[0]![1].body)).toEqual({ jobIds: ["a"] })
  })
})

describe("useGalleryInfinite fresh", () => {
  async function fetchPage(options?: { fresh?: boolean }) {
    let captured: { queryFn: (ctx: { pageParam?: string }) => Promise<unknown> } | undefined
    mockUseInfiniteQuery.mockImplementation((opts: typeof captured) => {
      captured = opts
      return {}
    })
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], nextCursor: null }) })
    useGalleryInfinite("all", undefined, false, options)
    await captured!.queryFn({ pageParam: undefined })
    return mockFetch.mock.calls.at(-1)![1] as RequestInit
  }

  it("an admin skips the browser's copy of the list", async () => {
    expect((await fetchPage({ fresh: true })).cache).toBe("no-cache")
  })

  it("everyone else keeps it", async () => {
    expect((await fetchPage()).cache).toBeUndefined()
  })
})
