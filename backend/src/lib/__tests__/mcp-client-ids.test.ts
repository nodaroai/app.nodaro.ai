import { describe, it, expect } from "vitest"
import { parseMcpAllowedClientIds } from "../mcp-client-ids.js"

/** `MCP_ALLOWED_CLIENT_IDS` (decided 2026-11-11): unset or blank is no list; anything else must be developer-app client ids. */
describe("parseMcpAllowedClientIds", () => {
  const A = `app_${"a".repeat(32)}`
  const B = `app_${"0123456789abcdef".repeat(2)}`

  it.each([undefined, "", "   ", "\n"])("%j: no list", (raw) => {
    expect(parseMcpAllowedClientIds(raw)).toEqual({ ok: true, ids: null })
  })

  it("one id, several, with spaces around them, a repeat", () => {
    expect(parseMcpAllowedClientIds(A)).toEqual({ ok: true, ids: new Set([A]) })
    expect(parseMcpAllowedClientIds(` ${A} , ${B},${A} `)).toEqual({ ok: true, ids: new Set([A, B]) })
  })

  it.each([
    [`${A},`, "entry 2 is empty"],
    [`,${A}`, "entry 1 is empty"],
    [`${A},,${B}`, "entry 2 is empty"],
    [`ndr_dcr_${"a".repeat(32)}`, "entry 1 is a client that registered itself"],
    [`${A},ndr_dcr_x`, "entry 2 is a client that registered itself"],
    [`app_${"A".repeat(32)}`, "entry 1 is not a developer app client_id"],
    [`app_${"a".repeat(31)}`, "entry 1 is not a developer app client_id"],
    [`app_${"a".repeat(33)}`, "entry 1 is not a developer app client_id"],
    ["Claude", "entry 1 is not a developer app client_id"],
    [`${A} ${B}`, "entry 1 is not a developer app client_id"],
    [`${A};${B}`, "entry 1 is not a developer app client_id"],
  ])("%j is refused (%s), never read as a shorter list", (raw, problem) => {
    const parsed = parseMcpAllowedClientIds(raw)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.problem).toContain(problem)
      // The boot message names the entry by position, never its value.
      expect(parsed.problem).not.toContain("a".repeat(31))
    }
  })
})
