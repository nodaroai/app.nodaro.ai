import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))
vi.mock("@/lib/edition", () => ({ hasAdmin: () => true }))

import { useAdminAccounts, useAdminUserByEmail, useAdminUserSearch, useAdminUsersByIds } from "../use-admin-user-lookup"

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const mockFetch = vi.fn()

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}
const asked = () => mockFetch.mock.calls.map((c) => new URL(String(c[0]), "http://x").searchParams)

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url: string) => {
    const ids = new URL(url, "http://x").searchParams.get("ids")?.split(",") ?? []
    const data = ids.map((i) => ({ id: i, email: `${i}@x.test`, fullName: null, role: "user" }))
    return new Response(JSON.stringify({ data }), { status: 200 })
  })
  vi.stubGlobal("fetch", mockFetch)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("useAdminUsersByIds", () => {
  it("asks for 201 ids in two calls of at most 200 (the route refuses more), and answers them all", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => id(i + 1))
    const { result } = renderHook(() => useAdminUsersByIds(ids), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const sizes = asked().map((p) => p.get("ids")!.split(",").length)
    expect(sizes.sort((a, b) => a - b)).toEqual([1, 200])
    expect(result.current.data).toHaveLength(201)
  })

  it("asks nothing for no ids", () => {
    const { result } = renderHook(() => useAdminUsersByIds([]), { wrapper })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.data).toEqual([])
  })
})

describe("the other lookups", () => {
  it("a search sends the text and the limit; no text, no request", async () => {
    renderHook(() => useAdminUserSearch(""), { wrapper })
    expect(mockFetch).not.toHaveBeenCalled()
    renderHook(() => useAdminUserSearch(" ops.le ", { limit: 8 }), { wrapper })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(Object.fromEntries(asked()[0]!)).toEqual({ search: "ops.le", limit: "8" })
  })

  it("an address is sent lower-cased, the admins as admins=1", async () => {
    renderHook(() => useAdminUserByEmail("Ops.Lead@Example.com"), { wrapper })
    renderHook(() => useAdminAccounts(), { wrapper })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(asked().map((p) => Object.fromEntries(p))).toEqual(
      expect.arrayContaining([{ email: "ops.lead@example.com" }, { admins: "1" }]),
    )
  })
})
