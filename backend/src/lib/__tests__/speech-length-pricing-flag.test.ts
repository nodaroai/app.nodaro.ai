/**
 * SPEECH_LENGTH_PRICING_ENABLED is read strictly: only "true" or "1" turn
 * length-based speech pricing on. A compose file or a Railway variable that
 * spells "false" must mean off (z.coerce.boolean() would read it as on — the
 * MCP_ENABLED rationale in config.ts). The flag is a boot-time env var:
 * staging runs `dev` code on the production database, so it is the ONE
 * switch that can differ between the two.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const ORIGINAL = process.env.SPEECH_LENGTH_PRICING_ENABLED

async function loadWith(value: string | undefined) {
  vi.resetModules()
  if (value === undefined) delete process.env.SPEECH_LENGTH_PRICING_ENABLED
  else process.env.SPEECH_LENGTH_PRICING_ENABLED = value
  return import("../config.js")
}

describe("SPEECH_LENGTH_PRICING_ENABLED", () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.SPEECH_LENGTH_PRICING_ENABLED
    else process.env.SPEECH_LENGTH_PRICING_ENABLED = ORIGINAL
  })

  it.each(["true", "1"])("%s turns it on", async (v) => {
    const mod = await loadWith(v)
    expect(mod.config.SPEECH_LENGTH_PRICING_ENABLED).toBe(true)
    expect(mod.speechLengthPricingEnabled()).toBe(true)
  })

  it.each([undefined, "", "false", "0", "yes", "on", "TRUE"])("%s leaves it off", async (v) => {
    const mod = await loadWith(v)
    expect(mod.config.SPEECH_LENGTH_PRICING_ENABLED).toBe(false)
    expect(mod.speechLengthPricingEnabled()).toBe(false)
  })
})
