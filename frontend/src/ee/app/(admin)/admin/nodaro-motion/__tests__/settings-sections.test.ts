// @test-watches backend/src/ee/routes/admin-nodaro-motion*.ts
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { MOTION_SETTINGS_KEYS } from "../settings-sections"

/**
 * The page's settings sections are the server's: a stored set holds the
 * sections the server declares (`defineNodaroMotionSettingsSection`, beside
 * each Nodaro Motion admin route; their own guard fails a route missing from
 * the list), and the page loads and saves the ones it knows. A key on one side
 * only would be a setting a set leaves out, or one the page cannot load.
 */
const ROUTES = join(__dirname, "..", "..", "..", "..", "..", "..", "..", "..", "backend", "src", "ee", "routes")

function serverKeys(): string[] {
  const keys: string[] = []
  for (const file of readdirSync(ROUTES).filter((f) => f.startsWith("admin-nodaro-motion") && f.endsWith(".ts"))) {
    const src = readFileSync(join(ROUTES, file), "utf8")
    for (const m of src.matchAll(/defineNodaroMotionSettingsSection\(\{\s*key:\s*"([^"]+)"/g)) keys.push(m[1]!)
  }
  return keys
}

describe("the Nodaro Motion settings sections", () => {
  it("are the server's, each once", () => {
    const server = serverKeys()
    expect(server.length).toBeGreaterThan(0)
    expect([...MOTION_SETTINGS_KEYS].sort()).toEqual([...server].sort())
    expect(new Set(MOTION_SETTINGS_KEYS).size).toBe(MOTION_SETTINGS_KEYS.length)
  })
})
