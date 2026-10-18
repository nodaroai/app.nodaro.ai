// @test-watches frontend/src/**/*.{ts,tsx}
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"

import { queryKeys } from "@/lib/query-keys"
import { keyUseAt, occurrences, stripComments } from "@/ee/shell/__tests__/query-key-uses"
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

describe("balance-refresh census (derived from the tree, not listed)", () => {
  const SRC = join(__dirname, "..", "..", "..")
  const HELPER = join("ee", "lib", "invalidate-balance.ts")
  const BALANCE = "queryKeys.credits.balance("

  function sourceFiles(dir: string): readonly string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(full)
      const isSource = (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !/\.(test|spec)\.tsx?$/.test(entry.name)
      return isSource ? [full] : []
    })
  }

  /** Every place a filter call (invalidate, refetch, reset, …) targets the app's balance key. */
  function balanceTargets(text: string): readonly number[] {
    const source = stripComments(text)
    return occurrences(source, [BALANCE])
      .filter(({ index }) => keyUseAt(source, index) === "target")
      .map(({ index }) => index)
  }

  it("every refresh of the app's balance key goes through invalidateBalance (so the header's key refreshes too)", () => {
    const outside = sourceFiles(SRC)
      .filter((file) => relative(SRC, file) !== HELPER)
      .filter((file) => balanceTargets(readFileSync(file, "utf8")).length > 0)
      .map((file) => relative(SRC, file))
    expect(outside).toEqual([])
  })

  it("the helper is in use (the census is not vacuous)", () => {
    const callers = sourceFiles(SRC)
      .filter((file) => relative(SRC, file) !== HELPER)
      .filter((file) => readFileSync(file, "utf8").includes("invalidateBalance("))
    expect(callers.length).toBeGreaterThan(0)
  })

  it("the scan catches a direct refresh and lets reads through (planted examples)", () => {
    expect(balanceTargets("qc.invalidateQueries({ queryKey: queryKeys.credits.balance(user.id) })")).toHaveLength(1)
    expect(balanceTargets("qc.refetchQueries({ queryKey: queryKeys.credits.balance(id) })")).toHaveLength(1)
    expect(balanceTargets("useQuery({ queryKey: queryKeys.credits.balance(id), queryFn })")).toHaveLength(0)
    expect(balanceTargets("qc.setQueryData(queryKeys.credits.balance(id), next)")).toHaveLength(0)
  })
})
