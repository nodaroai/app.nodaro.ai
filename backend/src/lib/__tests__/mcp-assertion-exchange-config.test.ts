import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { assertionExchangeClientIdsProblem, parseAssertionExchangeClientIds } from "../mcp-client-ids.js"

/**
 * The two environment levers of the MCP assertion exchange (decided
 * 2026-11-11), beside MCP_ALLOWED_CLIENT_IDS: which listed client(s) may use
 * the exchange, and how long the token it issues lives. Both are refused at
 * boot when they cannot be read, never ignored.
 */

const A = `app_${"a".repeat(32)}`
const B = `app_${"b".repeat(32)}`

describe("MCP_ASSERTION_EXCHANGE_CLIENT_IDS", () => {
  it.each([undefined, "", "  "])("%j: no client may use the exchange (it is off)", (raw) => {
    expect(parseAssertionExchangeClientIds(raw)).toEqual({ ok: true, ids: null })
    expect(assertionExchangeClientIdsProblem({ MCP_ASSERTION_EXCHANGE_CLIENT_IDS: raw, MCP_ALLOWED_CLIENT_IDS: A })).toBeNull()
    expect(assertionExchangeClientIdsProblem({ MCP_ASSERTION_EXCHANGE_CLIENT_IDS: raw })).toBeNull()
  })

  it("a listed client boots", () => {
    expect(assertionExchangeClientIdsProblem({ MCP_ASSERTION_EXCHANGE_CLIENT_IDS: ` ${A} `, MCP_ALLOWED_CLIENT_IDS: `${A},${B}` })).toBeNull()
    expect(parseAssertionExchangeClientIds(` ${A} `)).toEqual({ ok: true, ids: new Set([A]) })
  })

  it("without an MCP client list it stops the boot: the exchange exists only for a listed client", () => {
    expect(assertionExchangeClientIdsProblem({ MCP_ASSERTION_EXCHANGE_CLIENT_IDS: A })).toMatch(/requires MCP_ALLOWED_CLIENT_IDS/)
    expect(assertionExchangeClientIdsProblem({ MCP_ASSERTION_EXCHANGE_CLIENT_IDS: A, MCP_ALLOWED_CLIENT_IDS: " " })).toMatch(/requires MCP_ALLOWED_CLIENT_IDS/)
  })

  it("a client the MCP list does not name stops the boot, by position", () => {
    const problem = assertionExchangeClientIdsProblem({ MCP_ASSERTION_EXCHANGE_CLIENT_IDS: `${A},${B}`, MCP_ALLOWED_CLIENT_IDS: A })
    expect(problem).toMatch(/MCP_ASSERTION_EXCHANGE_CLIENT_IDS entry 2 is not listed in MCP_ALLOWED_CLIENT_IDS/)
    expect(problem).not.toContain(B)
  })

  it.each([`${A},`, `ndr_dcr_${"a".repeat(32)}`, "Chat app"])("%j stops the boot like the MCP list does", (raw) => {
    expect(assertionExchangeClientIdsProblem({ MCP_ASSERTION_EXCHANGE_CLIENT_IDS: raw, MCP_ALLOWED_CLIENT_IDS: A })).toMatch(/^MCP_ASSERTION_EXCHANGE_CLIENT_IDS entry/)
  })
})

describe("both levers at boot (config.ts)", () => {
  const ORIGINAL = {
    MCP_ALLOWED_CLIENT_IDS: process.env.MCP_ALLOWED_CLIENT_IDS,
    MCP_ASSERTION_EXCHANGE_CLIENT_IDS: process.env.MCP_ASSERTION_EXCHANGE_CLIENT_IDS,
    MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS: process.env.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS,
  }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(ORIGINAL)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it("unset: the exchange is off and the token lifetime defaults to one hour", async () => {
    delete process.env.MCP_ASSERTION_EXCHANGE_CLIENT_IDS
    delete process.env.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS
    const { config } = await import("../config.js")
    expect(config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS).toBe("")
    expect(config.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS).toBe(3600)
  })

  it("a blank lifetime (as Railway defines an emptied variable) is the default", async () => {
    process.env.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS = " "
    const { config } = await import("../config.js")
    expect(config.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS).toBe(3600)
  })

  it.each(["300", "86400", "900"])("a lifetime of %s seconds boots", async (value) => {
    process.env.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS = value
    const { config } = await import("../config.js")
    expect(config.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS).toBe(Number(value))
  })

  it.each(["299", "86401", "7776000", "1h", "0", "-5", "3600.5"])("a lifetime of %j stops the boot", async (value) => {
    process.env.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS = value
    await expect(import("../config.js")).rejects.toThrow(/MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS/)
  })

  it("an exchange client the MCP list does not name stops the boot", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = A
    process.env.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = B
    await expect(import("../config.js")).rejects.toThrow(/Invalid env vars: MCP_ASSERTION_EXCHANGE_CLIENT_IDS entry 1 is not listed/)
  })

  it("an exchange client the MCP list names boots", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = `${A},${B}`
    process.env.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = B
    const { config } = await import("../config.js")
    expect(config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS).toBe(B)
  })
})
