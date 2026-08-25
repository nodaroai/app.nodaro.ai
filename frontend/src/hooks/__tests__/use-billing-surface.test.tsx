import { describe, it, expect, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"

vi.mock("@/lib/api", () => ({
  getBillingSurface: vi.fn(async () => ({
    contract: 2, providerId: "nodaro-cloud", displayUnit: "credits",
    canReport: true, canQuote: false, canAccount: true, mountCostTab: true,
  })),
}))

import { useBillingSurface } from "../use-billing-surface"

it("resolves the deployment billing surface", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useBillingSurface(), { wrapper })
  await waitFor(() => expect(result.current.surface.mountCostTab).toBe(true))
  expect(result.current.surface.displayUnit).toBe("credits")
})
