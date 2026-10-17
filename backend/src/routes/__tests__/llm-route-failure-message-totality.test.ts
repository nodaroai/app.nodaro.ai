// @test-watches backend/src/routes/*.ts backend/src/nodes/*/route*.ts
/**
 * Every route that calls a model writes the PERSON's sentence on failure,
 * never the error's own message.
 *
 * An LLM lane error's `message` is its full diagnostic: the lane, the vendor,
 * and the provider's raw reply (staging 2026-10-14: "400 {…Your credit balance
 * is too low to access the … API…, request_id…}" on a node and in MCP
 * `get_job`). `userFacingMessage` / `laneUserMessage` (lib/user-facing-error.ts)
 * are the funnel that turns it into the user-safe sentence; the diagnostic
 * reaches `error_detail` and the logs.
 *
 * This fails a route file that reaches the LLM client and still assigns
 * `err instanceof Error ? err.message : …` to the `message` it fails a job or
 * answers with.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { unitRouteFiles } from "../../lib/route-inventory.js"

const ROUTES = join(__dirname, "..")
const REPO = join(__dirname, "..", "..", "..", "..")
const RAW_MESSAGE = /const message\s*=\s*err instanceof Error \? err\.message/

describe("LLM route failure messages go through userFacingMessage", () => {
  // The route files, plus every node unit's route (backend/src/nodes/<type>/route.ts | route.ee.ts), repo-relative.
  const files = [
    ...readdirSync(ROUTES).filter((f) => f.endsWith(".ts")).map((f) => relative(REPO, join(ROUTES, f))),
    ...unitRouteFiles(REPO).map((f) => relative(REPO, f)),
  ]
  const llmRoutes = files.filter((f) => {
    const src = readFileSync(join(REPO, f), "utf8")
    return src.includes("lib/llm-client.js") && src.includes("markJobFailed")
  })

  it("finds the LLM routes (the guard is not vacuous)", () => {
    expect(llmRoutes.length).toBeGreaterThan(10)
  })

  it.each(llmRoutes)("%s", (file) => {
    const src = readFileSync(join(REPO, file), "utf8")
    expect(RAW_MESSAGE.test(src), `${file} writes a raw err.message — use userFacingMessage(err, fallback)`).toBe(false)
  })
})
