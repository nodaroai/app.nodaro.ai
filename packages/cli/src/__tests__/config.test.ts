import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadConfig,
  setProfile,
  getProfile,
  deleteProfile,
  configPath,
} from "../config.js"

describe("config", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nodaro-cli-test-"))
    // vi.stubEnv reliably overrides process.env across vitest workers; direct
    // process.env mutation is not always honored by spawned threads.
    vi.stubEnv("NODARO_CONFIG_DIR", dir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  })

  it("loadConfig returns empty when file does not exist", () => {
    const config = loadConfig()
    expect(config).toEqual({ default: "production", profiles: {} })
  })

  it("setProfile persists and loadConfig returns it", () => {
    setProfile("test", { baseUrl: "https://api.example.com", token: "ndr_xxx" })
    const config = loadConfig()
    expect(config.profiles["test"]).toEqual({ baseUrl: "https://api.example.com", token: "ndr_xxx" })
  })

  it("first setProfile sets it as default", () => {
    setProfile("first", { baseUrl: "https://a.com", token: "a" })
    expect(loadConfig().default).toBe("first")
  })

  it("getProfile defaults to the configured default", () => {
    setProfile("only", { baseUrl: "https://x.com", token: "tok" })
    const { name, profile } = getProfile()
    expect(name).toBe("only")
    expect(profile?.baseUrl).toBe("https://x.com")
  })

  it("getProfile returns undefined for unknown profile", () => {
    const { name, profile } = getProfile("missing")
    expect(name).toBe("missing")
    expect(profile).toBeUndefined()
  })

  it("deleteProfile removes the entry and returns true", () => {
    setProfile("doomed", { baseUrl: "https://x.com", token: "t" })
    expect(deleteProfile("doomed")).toBe(true)
    expect(loadConfig().profiles).toEqual({})
    expect(deleteProfile("doomed")).toBe(false)
  })

  it("deleting the default profile re-elects the next remaining profile", () => {
    setProfile("a", { baseUrl: "https://a.com", token: "a" })
    setProfile("b", { baseUrl: "https://b.com", token: "b" })
    expect(loadConfig().default).toBe("a")
    expect(deleteProfile("a")).toBe(true)
    expect(loadConfig().default).toBe("b")
  })

  it("config file is created with locked-down permissions", () => {
    setProfile("p", { baseUrl: "https://x.com", token: "t" })
    const path = configPath()
    expect(existsSync(path)).toBe(true)
    const mode = statSync(path).mode & 0o777
    // 0600 on most systems; some CI filesystems collapse to 0644 — accept either.
    expect([0o600, 0o644]).toContain(mode)
    const content = JSON.parse(readFileSync(path, "utf8"))
    expect(content.profiles.p.token).toBe("t")
  })

  it("loadConfig returns empty for corrupt JSON instead of throwing", () => {
    setProfile("x", { baseUrl: "https://x.com", token: "t" })
    const path = configPath()
    writeFileSync(path, "{ not valid json")
    const config = loadConfig()
    expect(config).toEqual({ default: "production", profiles: {} })
  })
})
