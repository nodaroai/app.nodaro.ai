// @test-watches frontend/src/ee/app/(dashboard)/billing/page.tsx frontend/src/ee/components/welcome-offer/use-welcome-offer.ts frontend/src/ee/hooks/queries/use-billing-queries.ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"

import { queryKeys } from "@/lib/query-keys"
import { HEADER_BALANCE_KEY, invalidateBalance } from "../invalidate-balance"

/**
 * The balance lives in two cache entries once the shared site header is on:
 * the app's own `["credits","balance",<user>]` and the header's `["credits"]`.
 * A top-up, a plan change or the welcome credits must refresh both.
 */

function clientWith(userId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(queryKeys.credits.balance(userId), { total: 1 })
  qc.setQueryData(HEADER_BALANCE_KEY, { total: 1 })
  qc.setQueryData(queryKeys.credits.modelCost("some-model"), 5)
  return qc
}

describe("invalidateBalance", () => {
  it("marks both balance entries stale — and not the model prices beside them", async () => {
    const qc = clientWith("u1")
    await invalidateBalance(qc, "u1")
    expect(qc.getQueryState(queryKeys.credits.balance("u1"))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(HEADER_BALANCE_KEY)?.isInvalidated).toBe(true)
    expect(qc.getQueryState(queryKeys.credits.modelCost("some-model"))?.isInvalidated).toBe(false)
  })

  it("is the literal [\"credits\"] (held to the header's own exported key, both ways, by ee/shell/contract)", () => {
    expect(HEADER_BALANCE_KEY).toEqual(["credits"])
  })
})

describe("the balance refresh sites use it", () => {
  const SRC = join(__dirname, "..", "..", "..")
  const sites = [
    "ee/app/(dashboard)/billing/page.tsx",
    "ee/components/welcome-offer/use-welcome-offer.ts",
    "ee/hooks/queries/use-billing-queries.ts",
  ]
  it.each(sites)("%s", (site) => {
    const src = readFileSync(join(SRC, site), "utf8")
    expect(src).toMatch(/invalidateBalance\(/)
    expect(src).not.toMatch(/invalidateQueries\(\{ queryKey: queryKeys\.credits\.balance\(/)
  })
})
