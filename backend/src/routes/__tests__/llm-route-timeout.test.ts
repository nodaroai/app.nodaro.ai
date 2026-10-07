/**
 * The synchronous LLM routes hold a request for as long as an honest answer
 * takes. A hand-typed `requestTimeout: 120000` on `/v1/llm-chat/generate` cut
 * the orchestrator's internal call at two minutes — "UND_ERR_SOCKET: other
 * side closed" — and failed the run while the model call ran on and was
 * billed (2026-10-07). Every LLM route reads ONE constant, never a literal.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { LLM_ROUTE_REQUEST_TIMEOUT_MS } from "../../lib/llm-route-timeout.js"

const ROUTES = ["llm-chat.ts", "ai-writer.ts"] as const

describe("LLM route request timeout", () => {
  it("is at least ten minutes", () => {
    expect(LLM_ROUTE_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 60 * 1000)
  })

  for (const file of ROUTES) {
    it(`${file}: every requestTimeout is the shared constant, never a literal`, () => {
      const src = readFileSync(resolve(__dirname, "..", file), "utf8")
      const sites = [...src.matchAll(/requestTimeout:\s*([^,}]+)/g)].map((m) => m[1]!.trim())
      expect(sites.length).toBeGreaterThan(0)
      for (const site of sites) expect(site).toBe("LLM_ROUTE_REQUEST_TIMEOUT_MS")
    })
  }
})
