// @test-watches tools/units/manifest.mjs tools/units/reserved-credit-ids.json backend/src/ee/billing/** frontend/src/lib/node-options.tsx frontend/src/lib/*macro*.ts frontend/src/nodes/** backend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { TYPE_ID, loadUnits, repoContext, reservedIdsFrom } from "../../../tools/units/manifest.mjs"
import { CREDIT_COSTS, STATIC_CREDIT_COSTS } from "../ee/billing/credits.js"

/**
 * The validator reserves the credit ids a unit may not take
 * (tools/units/manifest.mjs reservedIdsFrom): a unit's price.ee.ts row is
 * keyed by its type, and composeRecord("STATIC_CREDIT_COSTS" | "CREDIT_COSTS")
 * throws at load on a collision — the backend would not boot. It reads the
 * two literals of credits.ts as text, plus tools/units/reserved-credit-ids.json
 * for the ids built in code. Held here to the runtime tables, so a credit id
 * the read misses fails loudly instead of letting `gen:units -- --new` write a
 * unit the backend cannot load.
 */

const ROOT = path.resolve(__dirname, "../../..")
const ctx = repoContext(ROOT)
const unitTypes = new Set(loadUnits(ROOT).map((u) => u.type))
const LIST = "tools/units/reserved-credit-ids.json"

/** Every whole credit id a unit type could equal (a composite "x:y" never can). */
const runtimeIds = [...new Set([...Object.keys(STATIC_CREDIT_COSTS), ...Object.keys(CREDIT_COSTS)])]
  .filter((id) => TYPE_ID.test(id) && !unitTypes.has(id))
  .sort()

describe("the validator's reserved credit ids are the runtime credit tables'", () => {
  it("every runtime credit id is a legacy node type or reserved", () => {
    const missing = runtimeIds.filter((id) => !ctx.legacyTypes.has(id) && !ctx.reserved?.has(id))
    expect(missing, `credit ids the validator would let a unit take (credits.ts builds them in code) — add them to ${LIST}`).toEqual([])
  })

  it(`${LIST} lists only code-built ids: each is a runtime credit id the text read does not already find`, () => {
    const listed = (JSON.parse(readFileSync(path.join(ROOT, LIST), "utf8")) as { ids: string[] }).ids
    const textOnly = reservedIdsFrom({ credits: readFileSync(path.join(ROOT, "backend/src/ee/billing/credits.ts"), "utf8") })
    const runtime = new Set(runtimeIds)
    expect(listed.filter((id) => !runtime.has(id)), `no longer a credit id — remove from ${LIST}`).toEqual([])
    expect(listed.filter((id) => textOnly.has(id) || ctx.legacyTypes.has(id)), `already refused (read from text, or a legacy node type) — remove from ${LIST}`).toEqual([])
    expect([...listed].sort(), `${LIST} is sorted`).toEqual(listed)
  })

  it("every id reserved as a credit id is one at run time (the text read invents none)", () => {
    const runtime = new Set(runtimeIds)
    const credit = (ctx.reserved ? [...ctx.reserved] : []).filter(([, why]) => why.startsWith("a credit id")).map(([id]) => id)
    expect(credit.length).toBeGreaterThan(50)
    expect(credit.filter((id) => !runtime.has(id))).toEqual([])
  })
})
