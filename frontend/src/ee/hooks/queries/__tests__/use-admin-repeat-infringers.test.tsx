import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ReactNode } from "react"
import { renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

/**
 * What each move on an account's record sends (backend
 * ee/routes/admin-repeat-infringers.ts): a move from a case names the account
 * the screen showed (`userId`), which the server takes or refuses; only an
 * import block carries a number of days; a lift and a withdrawal send their
 * reason alone; an unblock sends nothing.
 */

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}) }))
vi.mock("@/lib/edition", () => ({ hasAdmin: () => true }))

import { useApplyMeasure, useLiftMeasure, useRecordInfringement, useUnblockAccount, useWithdrawInfringement } from "../use-admin-repeat-infringers"

const fetchMock = vi.fn(async (_path: string, _init: RequestInit) => new Response(JSON.stringify({ data: {} }), { status: 200 }))

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
}

/** The path and the parsed body of the one request sent. */
function sent(): { path: string; body: unknown } {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [path, init] = fetchMock.mock.calls[0]!
  return { path, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined }
}

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the record's moves", () => {
  it("records an infringement against the account the screen showed", async () => {
    const { result } = renderHook(() => useRecordInfringement(), { wrapper })
    await result.current.mutateAsync({ complaintId: "c-1", userId: "u-1", note: "Theirs" })
    expect(sent()).toEqual({ path: "/v1/admin/complaints/c-1/infringement", body: { userId: "u-1", note: "Theirs" } })
  })

  it("takes a measure on the account the screen showed; days only for an import block", async () => {
    const { result } = renderHook(() => useApplyMeasure(), { wrapper })
    const base = { complaintId: "c-1", userId: "u-1", reason: "r", note: null, infringementId: "i-1", departureReason: null }
    await result.current.mutateAsync({ ...base, kind: "imports_blocked", days: 30 })
    expect(sent()).toEqual({
      path: "/v1/admin/complaints/c-1/measure",
      body: { userId: "u-1", kind: "imports_blocked", days: 30, reason: "r", note: null, infringementId: "i-1", departureReason: null },
    })
    fetchMock.mockClear()
    await result.current.mutateAsync({ ...base, kind: "warning", days: 30 })
    expect(sent().body).toEqual({ userId: "u-1", kind: "warning", reason: "r", note: null, infringementId: "i-1", departureReason: null })
  })

  it("withdraws and lifts with the reason alone; unblocks with nothing", async () => {
    const withdraw = renderHook(() => useWithdrawInfringement(), { wrapper }).result
    await withdraw.current.mutateAsync({ infringementId: "i-1", reason: "Restored" })
    expect(sent()).toEqual({ path: "/v1/admin/infringements/i-1/withdraw", body: { reason: "Restored" } })
    fetchMock.mockClear()
    const lift = renderHook(() => useLiftMeasure(), { wrapper }).result
    await lift.current.mutateAsync({ measureId: "m-1", reason: "Reversed" })
    expect(sent()).toEqual({ path: "/v1/admin/measures/m-1/lift", body: { reason: "Reversed" } })
    fetchMock.mockClear()
    const unblock = renderHook(() => useUnblockAccount(), { wrapper }).result
    await unblock.current.mutateAsync({ userId: "u-1" })
    expect(sent()).toEqual({ path: "/v1/admin/users/u-1/unblock", body: undefined })
  })
})
