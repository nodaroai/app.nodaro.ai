// @test-watches backend/src/routes/*.ts backend/src/lib/*.ts backend/src/ee/**/*.ts
/**
 * R63: which reserved holds can carry a metered LLM ledger — a metered LLM id
 * (the sweeps' parser) or a fixed + calls scrape id. The registry is held to
 * the funnel: every caller of `reserveFixedPlusLlmCalls` builds its fixed id
 * from a registered node type, and the funnel refuses any other.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { buildInstagramScrapeCreditId, buildMetaAdsScrapeCreditId } from "@nodaro/shared/social"
import { FIXED_PLUS_LLM_CALLS_NODE_TYPES, holdCanCarryLlmLedger, isFixedPlusLlmCallsHoldId } from "../llm-ledger-holds.js"
import { parseMeteredLlmId } from "../../ee/billing/metered-llm-id.js"

const SRC = join(__dirname, "..", "..")

describe("holdCanCarryLlmLedger", () => {
  it("a metered LLM id, or a fixed + calls scrape id — every tier and analysis spelling", () => {
    expect(holdCanCarryLlmLedger("generate-script:claude-sonnet-5.5", parseMeteredLlmId)).toBe(true)
    for (const id of [
      buildMetaAdsScrapeCreditId({ count: 100, sources: 1 }),
      buildMetaAdsScrapeCreditId({ count: 500, sources: 3, analysis: "premium" }),
      buildInstagramScrapeCreditId({ count: 50, sources: 1 }),
    ]) expect(isFixedPlusLlmCallsHoldId(id)).toBe(true)
  })

  it("never an image, a video, a tier LLM id or any other fixed price", () => {
    for (const id of ["generate-image:flux-2-pro", "kling:10s:audio", "generate-script:economy", "llm-chat:premium", "apify-scrape:100", "x"]) {
      expect(holdCanCarryLlmLedger(id, parseMeteredLlmId), id).toBe(false)
    }
    expect(holdCanCarryLlmLedger(undefined, parseMeteredLlmId)).toBe(false)
  })

  it("every reserveFixedPlusLlmCalls call site builds its fixed id from a registered scrape builder; the funnel refuses any other", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== "__tests__" && name !== "node_modules") walk(p, out) } else if (name.endsWith(".ts")) out.push(p)
      }
      return out
    }
    const BUILDERS: Record<string, string> = { buildMetaAdsScrapeCreditId: "meta-ads-scrape", buildInstagramScrapeCreditId: "instagram-scrape" }
    const callers = walk(SRC).filter((f) => /reserveFixedPlusLlmCalls\(req/.test(readFileSync(f, "utf8")))
    expect(callers.length).toBeGreaterThan(0)
    for (const f of callers) {
      const fixed = /fixedId:\s*(\w+)\(/.exec(readFileSync(f, "utf8"))?.[1]
      expect(fixed && BUILDERS[fixed], relative(SRC, f)).toBeTruthy()
      expect(FIXED_PLUS_LLM_CALLS_NODE_TYPES.has(BUILDERS[fixed!]!)).toBe(true)
    }
    const impl = readFileSync(join(SRC, "ee", "billing", "llm-fixed-plus-calls-impl.ts"), "utf8")
    expect(impl).toMatch(/if \(!isFixedPlusLlmCallsHoldId\(args\.fixedId\)\) \{\s*throw/)
  })
})
