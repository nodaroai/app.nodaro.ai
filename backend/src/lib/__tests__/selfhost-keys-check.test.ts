// @test-watches docker-compose.community.yml
/**
 * The CLI start.sh (and the compose file's one-shot check before the auth and
 * database services) run before anything starts: exit 1 with one line naming
 * what to fix when the install must not start, else exit 0 — loudly when the
 * quick-start runs on the public defaults.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkSelfhostKeys } from "../selfhost-keys-check.js"
import { SELFHOST_DEFAULT_JWT_SECRET, SELFHOST_MINT_KEYS_COMMAND } from "../selfhost-keys-settings.js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const compose = readFileSync(resolve(root, "docker-compose.community.yml"), "utf8")
const defaultOf = (name: string) => compose.match(new RegExp(`\\$\\{${name}:-([^}]+)\\}`))![1]!

const DEFAULTS = {
  SUPABASE_URL: defaultOf("SUPABASE_URL"),
  SUPABASE_JWT_SECRET: SELFHOST_DEFAULT_JWT_SECRET,
  SUPABASE_ANON_KEY: defaultOf("SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: defaultOf("SUPABASE_SERVICE_ROLE_KEY"),
}

describe("checkSelfhostKeys", () => {
  it("production on the defaults: exit 1, one line, under the caller's label", () => {
    const log = vi.fn()
    expect(checkSelfhostKeys({ ...DEFAULTS, NODE_ENV: "production", PUBLIC_URL: "https://studio.example.com" }, log, "[keys-check]")).toBe(1)
    expect(log).toHaveBeenCalledTimes(1)
    const line = log.mock.calls[0]![0] as string
    expect(line.startsWith("[keys-check] refusing to start: ")).toBe(true)
    expect(line).toContain(SELFHOST_MINT_KEYS_COMMAND)
    expect(line).not.toContain(DEFAULTS.SUPABASE_SERVICE_ROLE_KEY)
  })

  it("the quick-start on this machine: exit 0, with a warning", () => {
    const log = vi.fn()
    expect(checkSelfhostKeys({ ...DEFAULTS, NODE_ENV: "production", PUBLIC_URL: "http://localhost:3000" }, log)).toBe(0)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toMatch(/^\[start\.sh\] WARNING: /)
  })

  it("development: exit 0, silently", () => {
    const log = vi.fn()
    expect(checkSelfhostKeys({ ...DEFAULTS, NODE_ENV: "development", PUBLIC_URL: "https://studio.example.com" }, log)).toBe(0)
    expect(log).not.toHaveBeenCalled()
  })
})
