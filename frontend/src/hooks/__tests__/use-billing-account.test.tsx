import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

const getBillingAccount = vi.fn()
vi.mock("@/lib/api", () => ({ getBillingAccount: () => getBillingAccount() }))

// The account query is per-user, so the hook reads the authenticated id from
// useAuth() and scopes the query key by it. Read `authUser` at call time so a
// per-test override takes effect (the vi.mock factory is hoisted).
let authUser: { id: string } | null = { id: "user6" }
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: authUser }) }))

import { useBillingAccount } from "../use-billing-account"

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return { client, wrapper }
}

describe("useBillingAccount", () => {
  beforeEach(() => {
    getBillingAccount.mockReset()
    authUser = { id: "user6" }
  })

  it("does not fetch and returns null when disabled", () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBillingAccount(false), { wrapper })
    expect(getBillingAccount).not.toHaveBeenCalled()
    expect(result.current.account).toBeNull()
  })

  it("fetches and returns the account when enabled", async () => {
    getBillingAccount.mockResolvedValue({ plan: "pro", balance: 42, dailyAllowance: null, unit: "credits" })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBillingAccount(true), { wrapper })
    await waitFor(() => expect(result.current.account).not.toBeNull())
    expect(result.current.account?.plan).toBe("pro")
  })

  it("surfaces null distinctly when the authority is unavailable", async () => {
    getBillingAccount.mockResolvedValue(null)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBillingAccount(true), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.account).toBeNull()
    expect(result.current.isError).toBe(false)
  })

  it("scopes the query key to the authenticated userId (no cross-user cache leak)", async () => {
    authUser = { id: "user6" }
    getBillingAccount.mockResolvedValue({ plan: "free", balance: 0, dailyAllowance: null, unit: "credits" })
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBillingAccount(true), { wrapper })
    await waitFor(() => expect(result.current.account).not.toBeNull())

    const keys = client.getQueryCache().getAll().map((q) => q.queryKey)
    expect(keys).toContainEqual(["billing", "account", "user6"])
  })
})
