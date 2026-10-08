/**
 * The direct Anthropic lane sends `directFallbackModel` verbatim as the API
 * model id. Anthropic's ids read `claude-<line>-<major>[-<minor>]`, with a
 * `-YYYYMMDD` snapshot suffix only on models before the 4.6 generation — never
 * a dot. The slip this catches is copying the registry `id` instead
 * (`claude-opus-5.5`), which the direct lane would send to a 404 on every
 * fallback.
 */

import { describe, it, expect } from "vitest"
import { LLM_MODELS } from "@nodaro/shared"

const ANTHROPIC_MODEL_ID = /^claude-[a-z]+-\d+(-\d+)?(-\d{8})?$/

describe("direct Anthropic model ids", () => {
  const direct = LLM_MODELS.filter((m) => m.directFallbackModel !== undefined)

  it("are declared on Claude entries only — the direct Anthropic lane is the only one that reads them", () => {
    expect(direct.length).toBeGreaterThan(0)
    for (const m of direct) expect(m.vendor, m.id).toBe("anthropic")
  })

  it.each(direct.map((m) => [m.id, m.directFallbackModel] as const))("%s → %s has the vendor's id shape", (_id, id) => {
    expect(id).toMatch(ANTHROPIC_MODEL_ID)
  })
})
