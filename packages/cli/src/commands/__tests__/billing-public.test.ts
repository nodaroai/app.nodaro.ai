import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"
import { billingCommand } from "../billing.js"
import { setProfile } from "../../config.js"

/**
 * `nodaro billing plans` reads a public route, so it must work signed out —
 * with the REAL client builder and config (nothing about either is mocked
 * here): no profile saved, nothing sent but the request, no exit for missing
 * credentials. Only fetch is replaced, to see what goes over the wire.
 */

const PLANS = { data: [], topUps: [], topUpRange: { min: 5, max: 1000, currency: "USD" } }

let dir: string
let fetchMock: ReturnType<typeof vi.fn>
let stdout: string

async function run(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(billingCommand())
  await program.parseAsync(["node", "nodaro", ...args])
}

function sentTo(): { url: string; headers: Record<string, string> } {
  const [url, init] = fetchMock.mock.calls[0]! as [string, { headers: Record<string, string> }]
  return { url, headers: init.headers }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nodaro-cli-billing-"))
  vi.stubEnv("NODARO_CONFIG_DIR", dir)
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => PLANS }) as unknown as Response)
  vi.stubGlobal("fetch", fetchMock)
  stdout = ""
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout += String(chunk)
    return true
  })
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`)
  }) as never)
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

describe("nodaro billing plans — signed out", () => {
  it("works with no profile saved: asks the default instance, sends no credential", async () => {
    await run("billing", "plans", "--json")
    const { url, headers } = sentTo()
    expect(url).toBe("https://app.nodaro.ai/v1/billing/plans")
    expect(headers.Authorization).toBeUndefined()
    expect(JSON.parse(stdout)).toEqual(PLANS)
  })

  it("asks the saved profile's instance, still without its token", async () => {
    setProfile("production", { baseUrl: "https://acme.example", token: "ndr_secret" })
    await run("billing", "plans", "--json")
    const { url, headers } = sentTo()
    expect(url).toBe("https://acme.example/v1/billing/plans")
    expect(headers.Authorization).toBeUndefined()
  })

  it("--base-url wins over the profile", async () => {
    setProfile("production", { baseUrl: "https://acme.example", token: "ndr_secret" })
    await run("billing", "plans", "--base-url", "https://other.example", "--json")
    expect(sentTo().url).toBe("https://other.example/v1/billing/plans")
  })
})

describe("nodaro billing surface — signed out", () => {
  it("is public too: no profile needed, no credential sent", async () => {
    await run("billing", "surface", "--json")
    const { url, headers } = sentTo()
    expect(url).toBe("https://app.nodaro.ai/v1/billing/surface")
    expect(headers.Authorization).toBeUndefined()
  })
})
