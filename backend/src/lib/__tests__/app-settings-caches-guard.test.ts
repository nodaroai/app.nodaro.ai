// @test-watches backend/src/**/*.ts
/**
 * Every in-memory cache of `app_settings` checks the app_settings version
 * (app-settings-version.ts) before trusting what it holds.
 *
 * The writers need no guard: the database moves the version on every write
 * (migration 605's trigger, proven by
 * supabase/tests/app-settings-version.behavior.sql), so a new writer cannot
 * forget it. What CAN regress is a new READER that keeps the rows in module
 * memory and trusts them for its TTL: a save through another process would
 * again take up to that TTL to reach it (a run started seconds after an admin
 * saved, running on the old setting).
 *
 * The census: every backend file that queries `app_settings` and keeps
 * module-level state (a top-level `let`, or a top-level `const` bound to a
 * `new …`) uses the version (calls both `appSettingsVersion()` and
 * `appSettingsChangedSince(`), or is listed in UNVERSIONED with the reason.
 *
 * What a census cannot see: a cache kept somewhere other than module state
 * (a closure, a mutable object literal). Those are rare here; the
 * behavioural tests of each converted cache pin the version check itself
 * (app-settings-cross-process.test.ts here, ee/lib/__tests__/app-settings-config-caches.test.ts).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND_SRC = join(HERE, "..", "..")

/** Files that read app_settings and keep module state, but not a version-checked cache of it. Paths from backend/src. */
const UNVERSIONED: Readonly<Record<string, string>> = {
  "lib/nodaro-connect.ts": "no cache of the rows: its module state is a warn-once flag, and every read goes to the database",
  "lib/concurrency-lanes/enforcement.ts":
    "no cache of the rows: its module state is two registered hooks; the switch is mirrored into Redis every 30 s, written there at once by the admin route, and versioned by the row's updated_at",
  "ee/lib/trends/catalog-stamp.ts": "is a stamp of its own (`trends_catalog_stamp`, trusted 2 s), read by the trend answers it keeps",
  "lib/provider-credentials.ts":
    "STILL ON ITS TTL (30 s): its snapshot is mostly the provider_credentials table, which the version does not cover; a route that finds no provider forces a re-read",
  "ee/concurrency-lanes/plan-sizes.ts":
    "STILL ON ITS TTL (60 s): it caches the lane plan and override tables beside its two app_settings rows, and the version covers only app_settings",
}

const READS_APP_SETTINGS = /\.from\(\s*["'`]app_settings["'`]\s*\)/
const MODULE_STATE = /^(?:export\s+)?let\s+\w+|^(?:export\s+)?const\s+\w+(?:\s*:[^=\n]+)?\s*=\s*new\s+\w+/m

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules" || name === "_generated") continue
      out.push(...sourceFiles(path))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

const census = sourceFiles(BACKEND_SRC).flatMap((path) => {
  const code = withoutComments(readFileSync(path, "utf8"))
  if (!READS_APP_SETTINGS.test(code) || !MODULE_STATE.test(code)) return []
  return [{ file: relative(BACKEND_SRC, path).split(sep).join("/"), code }]
})

describe("app_settings caches use the version", () => {
  it("finds the caches it is about (the census is not vacuous)", () => {
    const files = census.map((c) => c.file)
    for (const known of ["lib/app-settings.ts", "ee/lib/consent-config.ts", "ee/lib/welcome-offer-config.ts"]) {
      expect(files).toContain(known)
    }
  })

  it.each(census.map((c) => [c.file, c.code] as const))("%s checks the version or says why not", (file, code) => {
    if (file in UNVERSIONED) return
    const versioned = /\bappSettingsVersion\(\)/.test(code) && /\bappSettingsChangedSince\(/.test(code)
    expect(
      versioned,
      `${file} reads app_settings and keeps module state, but does not check the app_settings version. ` +
        "A save through another process would reach it only on its TTL. Read appSettingsVersion() before the rows, " +
        "keep it with them, and trust the copy only while !(await appSettingsChangedSince(kept)) — as lib/app-settings.ts does — " +
        "or, if it keeps no copy of the rows, list it in UNVERSIONED with the reason.",
    ).toBe(true)
  })

  it("every UNVERSIONED entry is still a file the census finds (no stale reasons)", () => {
    const files = new Set(census.map((c) => c.file))
    for (const file of Object.keys(UNVERSIONED)) expect(files.has(file), `${file} is no longer an app_settings reader with module state: drop it from UNVERSIONED`).toBe(true)
  })

  it("an UNVERSIONED file does not also half-use the version", () => {
    for (const { file, code } of census) {
      if (!(file in UNVERSIONED)) continue
      expect(/\bappSettingsChangedSince\(/.test(code), `${file} uses the version now: drop it from UNVERSIONED`).toBe(false)
    }
  })
})
