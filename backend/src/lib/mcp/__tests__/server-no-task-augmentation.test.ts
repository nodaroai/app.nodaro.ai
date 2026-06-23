import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const serverSrc = readFileSync(join(here, "..", "server.ts"), "utf8")

// Regression guard for the "single-job widget stuck on Initializing…" outage.
//
// Advertising `capabilities.tasks.requests.tools.call` opts every tools/call
// into client-side task augmentation. Claude.ai web then runs the job tools
// (generate_image, suno_generate, …) AS TASKS — awaiting completion via
// tasks/result and NEVER delivering ui/notifications/tool-result to the
// iframe — so the single-job widget sits on "Initializing…" forever while the
// gallery widget (read-only, not augmented) works. Our widgets do not use
// tasks/*; they poll get_asset / get_app_run via tools/call. The opt-in must
// stay OFF. (Root cause first shipped in d3fbc97c2; removed afterwards.)
describe("MCP server must not opt tools/call into task augmentation", () => {
  it("does not advertise requests.tools.call in the tasks capability", () => {
    // Strip comments first — the explanatory note above the capability block
    // deliberately spells out the forbidden `requests: { tools: { call ... } }`
    // shape, and we must match CODE, not prose.
    const codeOnly = serverSrc
      .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
      .replace(/\/\/[^\n]*/g, "") // line comments
      .replace(/\s+/g, " ")
    expect(codeOnly).not.toMatch(/requests:\s*\{\s*tools:\s*\{\s*call/)
  })
})
