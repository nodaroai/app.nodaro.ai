// @test-watches docker-compose.community.yml tools/generate-selfhost-keys.mjs
/**
 * The API's own configuration refuses a production install on the public
 * default Supabase keys (lib/selfhost-keys-settings.ts), in every process —
 * the guard for a process started without start.sh. Development, tests and
 * the install's own keys load as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const compose = readFileSync(resolve(root, "docker-compose.community.yml"), "utf8")
const defaultOf = (name: string) => compose.match(new RegExp(`\\$\\{${name}:-([^}]+)\\}`))![1]!

const PUBLIC_INSTALL = { NODE_ENV: "production", PUBLIC_URL: "https://studio.example.com", SUPABASE_URL: defaultOf("SUPABASE_URL") }

function stub(env: Record<string, string>): void {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
}

describe("config.ts refuses the public default Supabase keys in production", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("the shipped defaults on a public address: the boot fails, naming each variable, never a value", async () => {
    const defaults = {
      SUPABASE_JWT_SECRET: defaultOf("SUPABASE_JWT_SECRET"),
      SUPABASE_ANON_KEY: defaultOf("SUPABASE_ANON_KEY"),
      SUPABASE_SERVICE_ROLE_KEY: defaultOf("SUPABASE_SERVICE_ROLE_KEY"),
    }
    stub({ ...PUBLIC_INSTALL, ...defaults })
    const error = await import("../config.js").then(() => null, (e: unknown) => e as Error)
    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toMatch(/^Invalid env vars: this install runs in production/)
    for (const name of Object.keys(defaults)) expect(error!.message).toContain(name)
    for (const value of Object.values(defaults)) expect(error!.message).not.toContain(value)
    expect(error!.message).toContain("node tools/generate-selfhost-keys.mjs >> .env")
  })

  it("the install's own set loads", async () => {
    const out = execFileSync(process.execPath, [resolve(root, "tools", "generate-selfhost-keys.mjs")], { encoding: "utf8" })
    const minted = Object.fromEntries(out.trim().split("\n").map((line) => {
      const at = line.indexOf("=")
      return [line.slice(0, at), line.slice(at + 1)]
    }))
    stub({ ...PUBLIC_INSTALL, ...minted })
    await expect(import("../config.js")).resolves.toHaveProperty("config")
  })

  it("tests and development load on the defaults", async () => {
    stub({
      ...PUBLIC_INSTALL,
      NODE_ENV: "test",
      SUPABASE_JWT_SECRET: defaultOf("SUPABASE_JWT_SECRET"),
      SUPABASE_SERVICE_ROLE_KEY: defaultOf("SUPABASE_SERVICE_ROLE_KEY"),
    })
    await expect(import("../config.js")).resolves.toHaveProperty("config")
  })
})
