/**
 * `config.<PROVIDER>_KEY` is live: env first, then the app-managed snapshot.
 * The ~120 call sites keep reading `config.KIE_API_KEY` and get the key that
 * is actually in force — no restart after the operator pastes one on /setup.
 */
import { describe, it, expect, afterEach } from "vitest"
import { config } from "../config.js"
import { applyAppSnapshot, resolveProviderKey } from "../provider-keys-runtime.js"

const originalKie = config.KIE_API_KEY
const originalFal = config.FAL_KEY

afterEach(() => {
  applyAppSnapshot({})
  config.KIE_API_KEY = originalKie
  config.FAL_KEY = originalFal
})

describe("config provider-key getters", () => {
  it("reads the app-managed key when env is empty, and reports the source", () => {
    config.KIE_API_KEY = ""
    applyAppSnapshot({ kie: "kie_from_app" })
    expect(config.KIE_API_KEY).toBe("kie_from_app")
    expect(resolveProviderKey("kie")).toEqual({ value: "kie_from_app", source: "app" })
  })

  it("env wins over the app-managed key", () => {
    config.KIE_API_KEY = "kie_from_env"
    applyAppSnapshot({ kie: "kie_from_app" })
    expect(config.KIE_API_KEY).toBe("kie_from_env")
    expect(resolveProviderKey("kie")?.source).toBe("env")
  })

  it("assignment (what existing tests do) writes the env layer and reads back", () => {
    config.FAL_KEY = "fal_test"
    expect(config.FAL_KEY).toBe("fal_test")
    expect(resolveProviderKey("fal")).toEqual({ value: "fal_test", source: "env" })
  })

  it("is an empty string, never undefined, when nothing is set (call sites test truthiness)", () => {
    config.KIE_API_KEY = ""
    applyAppSnapshot({})
    expect(config.KIE_API_KEY).toBe("")
  })

  it("survives object spread (the MCP allowlist wrapper spreads config)", () => {
    config.FAL_KEY = "spread_me"
    const copy = { ...config }
    expect(copy.FAL_KEY).toBe("spread_me")
  })
})
