// @test-units-by-name it names no node unit
/**
 * The environment header every database call carries (lib/supabase.ts): only
 * a name an HTTP header can hold is sent. Anything else would make every call
 * fail, so it is not sent at all (and the server says so).
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@supabase/supabase-js", () => ({ createClient: (...a: unknown[]) => ({ args: a }) }))

const { runtimeEnvHeaderValue, RUNTIME_ENV_HEADER, RUNTIME_ENV_NAMEABLE, supabase } = await import("../supabase.js")
const { getRuntimeEnv } = await import("../runtime-env.js")

describe("the environment header", () => {
  it("carries a plain name as it is", () => {
    for (const env of ["production", "staging", "pr-123_eu.west"]) expect(runtimeEnvHeaderValue(env)).toBe(env)
  })

  it("is not sent for a name a header cannot hold: non-ASCII, a space, a line break, empty, or too long", () => {
    for (const env of ["סביבה", "prod uction", "prod\r\nX-Evil: 1", "", "é", "x".repeat(65)]) expect(runtimeEnvHeaderValue(env)).toBeNull()
  })

  it("this server's client sends its own environment", () => {
    const options = (supabase as unknown as { args: unknown[] }).args[2] as { global: { headers: Record<string, string> } }
    expect(RUNTIME_ENV_NAMEABLE).toBe(true)
    expect(options.global.headers).toEqual({ [RUNTIME_ENV_HEADER]: getRuntimeEnv() })
  })
})
