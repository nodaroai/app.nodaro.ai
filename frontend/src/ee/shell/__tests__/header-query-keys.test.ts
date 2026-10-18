// @test-watches frontend/src/**/*.{ts,tsx}
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

import { queryKeys } from "@/lib/query-keys"
import { HEADER_QUERY_KEYS } from "../query-keys"
import { factoryPathsEqualTo, keyUseAt, literalSpellings, occurrences, stripComments } from "./query-key-uses"

/**
 * The shared header is handed the app's own QueryClient and keeps its data
 * under four EXACT keys (`["credits"]`, `["me"]`, `["billing-plans"]`,
 * `["connected-apps"]`). An app query under one of them would share — and
 * overwrite — the header's entry with data of another shape. Invalidating by
 * one of them as a PREFIX is fine (that is how a refresh reaches the header).
 * The keys are derived (the header-key module, held to the package by the
 * contract job, and every `queryKeys` path that evaluates to one), not listed.
 */

const SRC = join(__dirname, "..", "..", "..")
/** The header's own module, and the key factory (its keys are checked where they are used). */
const SKIP = /^(ee[\\/]shell[\\/]|lib[\\/]query-keys\.ts$)/

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : []
  })
}

const KEYS = Object.values(HEADER_QUERY_KEYS)
const FACTORY_EXPRESSIONS = KEYS.flatMap((key) => factoryPathsEqualTo(queryKeys as unknown as Record<string, unknown>, key))

function headerKeyEntryUses(text: string): readonly string[] {
  const source = stripComments(text)
  const viaFactory = occurrences(source, FACTORY_EXPRESSIONS).filter(({ index }) => keyUseAt(source, index) !== "target")
  const viaLiteral = KEYS.flatMap((key) =>
    literalSpellings(key).flatMap((pattern) => [...source.matchAll(pattern)].filter((m) => keyUseAt(source, m.index ?? 0) !== "target").map((m) => m[0])),
  )
  return [...viaFactory.map((o) => o.expression), ...viaLiteral]
}

describe("the header's cache keys in the shared QueryClient", () => {
  it("the factory paths that equal a header key are found (today: credits.all)", () => {
    expect(FACTORY_EXPRESSIONS).toContain("queryKeys.credits.all")
  })

  it("no app code reads or writes an entry under one of the header's exact keys", () => {
    const violations = sourceFiles(SRC)
      .filter((file) => !SKIP.test(relative(SRC, file)))
      .flatMap((file) => headerKeyEntryUses(readFileSync(file, "utf8")).map((use) => `${relative(SRC, file)}: ${use}`))
    expect(violations).toEqual([])
  })

  it("the scan catches what it must (planted examples)", () => {
    expect(headerKeyEntryUses(`useQuery({ queryKey: ["credits"], queryFn })`)).toEqual(['["credits"]'])
    expect(headerKeyEntryUses(`queryOptions({ queryKey: ['connected-apps'], queryFn })`)).toEqual(["['connected-apps']"])
    expect(headerKeyEntryUses(`qc.setQueryData(queryKeys.credits.all, next)`)).toEqual(["queryKeys.credits.all"])
    expect(headerKeyEntryUses(`const k = [ "me" ]`)).toEqual(['[ "me" ]'])
    expect(headerKeyEntryUses(`qc.invalidateQueries({ queryKey: queryKeys.credits.all })`)).toEqual([])
    expect(headerKeyEntryUses(`useQuery({ queryKey: queryKeys.credits.balance(id), queryFn })`)).toEqual([])
    expect(headerKeyEntryUses(`// the header shows ["credits"]\nconst x = 1`)).toEqual([])
  })
})
