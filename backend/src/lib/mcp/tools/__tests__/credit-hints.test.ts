import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { creditsOf, creditHint, perSecondHint } from "../_credit-hint.js"
import { STATIC_CREDIT_COSTS } from "../../../../ee/billing/credits.js"

// Audit 2026-09-06 fix #4 (A-1 / C-7, R2b-L2 — worse since June): credit
// figures typed by hand into tool descriptions were 10–12× off the pricing
// table ("kling-turbo (5s, 10 credits)" — the table says 110; "wav2lip (1 cr)"
// — 10; "kling-avatar (28 cr)" — 300 per 15 s). Every agent read a wrong price. The
// only number a description may carry is one derived from
// STATIC_CREDIT_COSTS at registration — the VIDEO_ANALYSIS_PRICING_HINT
// discipline — and this test is the tripwire on the literal.
describe("_credit-hint — derived credit figures", () => {
  it("reads the static table and refuses an unknown id at registration", () => {
    expect(creditsOf("kling-turbo:5s")).toBe(STATIC_CREDIT_COSTS["kling-turbo:5s"])
    expect(creditHint("latentsync")).toBe(`${STATIC_CREDIT_COSTS["latentsync"]} cr`)
    expect(() => creditsOf("not-a-model-id")).toThrow(/unknown credit id/)
  })

  it("derives a per-second rate from the 15 s bucket for per-second providers", () => {
    expect(perSecondHint("volcengine-lipsync")).toBe(`${STATIC_CREDIT_COSTS["volcengine-lipsync:15s"] / 15} cr/s`)
  })
})

describe("tool descriptions carry no hand-typed credit figure", () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const toolsDir = resolve(here, "..")
  const LITERAL = /\b\d+(?:\.\d+)?\s*(?:cr|credits?)\b/g

  it("no `<number> cr|credit(s)` literal remains in backend/src/lib/mcp/tools/*.ts", () => {
    const offenders: string[] = []
    for (const file of readdirSync(toolsDir)) {
      if (!file.endsWith(".ts") || file === "_credit-hint.ts") continue
      const src = readFileSync(resolve(toolsDir, file), "utf8")
      src.split("\n").forEach((line, i) => {
        // Only string content counts: a comment may explain a price, a
        // description must derive it.
        const code = line.replace(/\/\/.*$/, "")
        if (LITERAL.test(code)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`)
        LITERAL.lastIndex = 0
      })
    }
    expect(offenders).toEqual([])
  })
})
