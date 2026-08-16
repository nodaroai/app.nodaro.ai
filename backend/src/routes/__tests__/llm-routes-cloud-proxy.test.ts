/**
 * Every route that calls the LLM client directly must forward to the cloud on
 * a keyless connected install (maybeProxyLlmRouteToCloud) — or be listed here
 * with the reason it does not. The LLM lane never reaches the capability
 * router, so a route that forgets the proxy fails a connected install with
 * "no provider" while its siblings work: that is how Choose Best (reduce)
 * and Motion Graphics were found on 2026-08-16, months after #642 wired the
 * other thirteen. This test turns "remember to add the proxy" into a build
 * failure.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROUTES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** Direct LLM entry points a route file may call. */
const LLM_CALL = /\b(llmComplete|llmStream|llmCompleteStructured)\s*\(/

/**
 * Routes that call the LLM but do NOT proxy, each with the reason. A new
 * entry needs a reason that would survive a reviewer asking "why does this
 * one fail on a connected keyless install?".
 */
const NOT_PROXIED: Readonly<Record<string, string>> = {
  // Entity routes: the LLM call is one step inside an operation that reads
  // and writes rows in THIS database — the id in the path does not exist on
  // the cloud (see the note at the bottom of lib/cloud-llm-proxy.ts).
  "character-portrait-approval.ts": "entity route — the caption is one step of an operation on THIS database's rows",
  // Optional enhancement: the LLM only auto-fills a description inside a
  // try/catch; the generation itself goes through the router (and thus the
  // connection). A keyless install just gets no auto-description.
  "generate-character-asset.ts": "optional description auto-fill inside try/catch; the job itself routes through the connection",
  "generate-character-motion.ts": "optional prompt refinement inside try/catch; the job itself routes through the connection",
  "generate-creature-asset.ts": "optional description auto-fill inside try/catch; the job itself routes through the connection",
  "generate-object-asset.ts": "optional description auto-fill inside try/catch; the job itself routes through the connection",
  "image-to-image.ts": "optional description auto-fill inside try/catch; the job itself routes through the connection",
}

/**
 * Routes whose LLM call lives OUTSIDE the route file (a strategy or service
 * module) — the grep above cannot see it, so they are named here and must
 * proxy like the rest.
 */
const LLM_VIA_SERVICE = ["reduce.ts"] as const

describe("LLM routes on a connected keyless install", () => {
  const routeFiles = readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  const llmRoutes = routeFiles.filter((f) => LLM_CALL.test(readFileSync(resolve(ROUTES_DIR, f), "utf8")))
  const mustProxy = [...new Set([...llmRoutes, ...LLM_VIA_SERVICE])].filter((f) => !(f in NOT_PROXIED))

  it("finds the LLM routes (sanity — the scan must not go blind)", () => {
    expect(llmRoutes.length).toBeGreaterThanOrEqual(15)
    for (const f of ["ai-writer.ts", "qa-check.ts", "motion-graphics-ai.ts"]) expect(llmRoutes, f).toContain(f)
  })

  it("every LLM route forwards to the cloud (maybeProxyLlmRouteToCloud) unless it is allowlisted with a reason", () => {
    const missing = mustProxy.filter((f) => !readFileSync(resolve(ROUTES_DIR, f), "utf8").includes("maybeProxyLlmRouteToCloud("))
    expect(missing, `routes that call the LLM but do not proxy to the connection: ${missing.join(", ")}`).toEqual([])
  })

  it("the allowlist only names routes that actually call the LLM (a stale entry hides a regression)", () => {
    const stale = Object.keys(NOT_PROXIED).filter((f) => !llmRoutes.includes(f))
    expect(stale, `allowlisted but no longer calling the LLM: ${stale.join(", ")}`).toEqual([])
  })

  it("the reduce route forwards only its LLM strategy — local strategies never leave the server", () => {
    const src = readFileSync(resolve(ROUTES_DIR, "reduce.ts"), "utf8")
    // The decision reads the strategy's own usesLlm flag, not its name.
    expect(src).toMatch(/getStrategy\([^)]*\)\.usesLlm/)
    expect(src).toContain('maybeProxyLlmRouteToCloud(req, reply, "/v1/reduce", "reduce", reduceProxyHooks(req.body))')
  })
})
