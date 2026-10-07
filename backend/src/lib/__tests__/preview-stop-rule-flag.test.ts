/**
 * The preview stop rule ships behind PREVIEW_STOP_RULE_ENABLED (decided
 * 2026-10-05): on in staging, off in production until Render final lands.
 * Opt-in, strictly parsed, and read at CALL time so a deployment's value is
 * the one every check sees.
 */
import { describe, it, expect, afterEach } from "vitest"
import { config, envSchema } from "../config.js"
import { previewStopRuleEnabled } from "../preview-stop-rule-flag.js"

const original = config.PREVIEW_STOP_RULE_ENABLED

afterEach(() => {
  ;(config as { PREVIEW_STOP_RULE_ENABLED: boolean }).PREVIEW_STOP_RULE_ENABLED = original
})

describe("PREVIEW_STOP_RULE_ENABLED", () => {
  it("is opt-in and never reads the string false as on", () => {
    const schema = envSchema.shape.PREVIEW_STOP_RULE_ENABLED
    expect(schema.parse(undefined)).toBe(false)
    for (const value of ["false", "0", "", "TRUE", "yes"]) expect(schema.parse(value)).toBe(false)
    for (const value of ["true", "1"]) expect(schema.parse(value)).toBe(true)
  })

  it("previewStopRuleEnabled reads the config at call time", () => {
    ;(config as { PREVIEW_STOP_RULE_ENABLED: boolean }).PREVIEW_STOP_RULE_ENABLED = false
    expect(previewStopRuleEnabled()).toBe(false)
    ;(config as { PREVIEW_STOP_RULE_ENABLED: boolean }).PREVIEW_STOP_RULE_ENABLED = true
    expect(previewStopRuleEnabled()).toBe(true)
  })
})
