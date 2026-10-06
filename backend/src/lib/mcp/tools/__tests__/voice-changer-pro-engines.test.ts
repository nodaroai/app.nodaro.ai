import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { VOICE_CHANGER_PRO_ENGINES } from "../voice-changer-pro-engines.js"

/**
 * The MCP `voice_changer_pro` engine enum must be exactly what the Cloud
 * plugin's route accepts: a value here the pinned plugin refuses turns every
 * such call into a 400 after the schema let it through. One constant, read by
 * the schema — never a second hand-kept list.
 */
describe("voice_changer_pro engine enum", () => {
  it("is exactly the plugin route's engines", () => {
    expect([...VOICE_CHANGER_PRO_ENGINES]).toEqual(["sts", "v3", "v4"])
  })

  it("the MCP tool schema reads the constant (no second hand-kept list) and its description names v4", () => {
    const src = readFileSync(join(__dirname, "..", "verbs-audio.ts"), "utf8")
    expect(src).toContain("engine: z.enum(VOICE_CHANGER_PRO_ENGINES)")
    expect(src).not.toMatch(/engine: z\.enum\(\["sts", "v3"\]\)/)
    expect(src).toContain("engine sts|v3|v4")
  })
})
