import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"
import { presetsCommand } from "../presets.js"
import { setProfile } from "../../config.js"

/**
 * `nodaro presets list --factory` reads a public route (the built-in preset
 * catalog), so it must work signed out — with the REAL client builder and
 * config (nothing about either is mocked here): no profile saved, nothing sent
 * but the request, no exit for missing credentials. Only fetch is replaced, to
 * see what goes over the wire. Your OWN presets still need a profile.
 */

const CATALOG = {
  data: [
    { id: "generate-image/character-board", name: "Character Board", group: "Reference Sheet", data: {}, minReferences: 1, needsImage: true, previewUrl: null },
  ],
}

let dir: string
let fetchMock: ReturnType<typeof vi.fn>
let stdout: string
let stderr: ReturnType<typeof vi.spyOn>

async function run(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(presetsCommand())
  await program.parseAsync(["node", "nodaro", ...args])
}

function sentTo(): { url: string; headers: Record<string, string> } {
  const [url, init] = fetchMock.mock.calls[0]! as [string, { headers: Record<string, string> }]
  return { url, headers: init.headers }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nodaro-cli-presets-"))
  vi.stubEnv("NODARO_CONFIG_DIR", dir)
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => CATALOG }) as unknown as Response)
  vi.stubGlobal("fetch", fetchMock)
  stdout = ""
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout += String(chunk)
    return true
  })
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`)
  }) as never)
  stderr = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

describe("nodaro presets list --factory — signed out", () => {
  it("works with no profile saved: asks the default instance, sends no credential", async () => {
    await run("presets", "list", "--factory", "--node-type", "generate-image", "--json")
    const { url, headers } = sentTo()
    expect(url).toBe("https://app.nodaro.ai/v1/node-presets/factory?nodeType=generate-image")
    expect(headers.Authorization).toBeUndefined()
    expect(JSON.parse(stdout)).toEqual(CATALOG)
  })

  it("asks the saved profile's instance, still without its token", async () => {
    setProfile("production", { baseUrl: "https://acme.example", token: "ndr_secret" })
    await run("presets", "list", "--factory", "--node-type", "generate-image", "--json")
    const { url, headers } = sentTo()
    expect(url).toBe("https://acme.example/v1/node-presets/factory?nodeType=generate-image")
    expect(headers.Authorization).toBeUndefined()
  })

  it("--base-url wins over the profile", async () => {
    setProfile("production", { baseUrl: "https://acme.example", token: "ndr_secret" })
    await run("presets", "list", "--factory", "--node-type", "generate-image", "--base-url", "https://other.example", "--json")
    expect(sentTo().url).toBe("https://other.example/v1/node-presets/factory?nodeType=generate-image")
  })
})

describe("nodaro presets list (your own) — still needs a profile", () => {
  it("exits asking for `nodaro auth login` when none is saved, without a request", async () => {
    await expect(run("presets", "list", "--json")).rejects.toThrow(/process\.exit\(1\)/)
    expect(stderr.mock.calls.flat().join("\n")).toMatch(/nodaro auth login/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses --base-url without --factory: it only picks the instance for the public catalog", async () => {
    setProfile("production", { baseUrl: "https://acme.example", token: "ndr_secret" })
    await expect(run("presets", "list", "--base-url", "https://other.example", "--json")).rejects.toThrow(/process\.exit\(1\)/)
    expect(stderr.mock.calls.flat().join("\n")).toMatch(/--base-url only applies with --factory/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
