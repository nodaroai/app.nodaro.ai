// @test-watches backend/src/**/*.ts
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

/**
 * Totality guard for two surface-profile switches (decided 2026-11-11):
 *
 *  - `developerApps.manage: "admin"` — every route that writes a developer
 *    app asks `refuseUnlessDeveloperAppManager` (routes/developer-apps.ts), and
 *    every other file that writes `developer_apps` is a reasoned entry here;
 *  - the public app listing follows the hidden `apps` navigation entry — every
 *    file that lists other people's published apps by their listing flag asks
 *    `surfaceListsPublishedApps`, or is a reasoned entry.
 *
 * Comments are stripped first (the TypeScript printer). Every reasoned entry
 * must still match a file, so the lists only shrink.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, "..", "..")

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...filesUnder(full))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(full)
    }
  }
  return out
}

const printer = ts.createPrinter({ removeComments: true })
const SOURCES = filesUnder(SRC).map((f) => ({
  rel: relative(SRC, f).split("\\").join("/"),
  text: printer.printFile(ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true)),
}))

describe("developer apps: every write asks who may manage them", () => {
  const routes = SOURCES.find((s) => s.rel === "routes/developer-apps.ts")!.text

  it("every writing route in routes/developer-apps.ts asks refuseUnlessDeveloperAppManager", () => {
    const starts = [...routes.matchAll(/\bapp\s*\.\s*(get|post|patch|put|delete)\s*\(\s*"([^"]+)"/g)]
    expect(starts.length).toBeGreaterThanOrEqual(6)
    const unguarded: string[] = []
    starts.forEach((m, i) => {
      const body = routes.slice(m.index!, starts[i + 1]?.index ?? routes.length)
      if (m[1] !== "get" && !/\brefuseUnlessDeveloperAppManager\s*\(/.test(body)) unguarded.push(`${m[1].toUpperCase()} ${m[2]}`)
    })
    expect(unguarded).toEqual([])
  })

  /** Files outside the routes above that write `developer_apps`, and why the switch does not govern them. */
  const OTHER_WRITERS: Record<string, string> = {
    "routes/oauth-register.ts":
      "Dynamic client registration (RFC 7591): governed by MCP_DYNAMIC_REGISTRATION, and closed whenever MCP_ALLOWED_CLIENT_IDS is set; never a person creating an app.",
    "routes/oauth.ts": "Consent claims a self-registered row for the first person who consents; it creates no client.",
    "lib/oauth-dcr-sweep.ts": "The hourly sweep deletes self-registered rows nobody consented to.",
  }

  it("names every other file that writes developer_apps", () => {
    const writers = SOURCES.filter((s) => s.rel !== "routes/developer-apps.ts" && /from\s*\(\s*"developer_apps"\s*\)/.test(s.text) && /\.\s*(?:insert|update|upsert|delete)\s*\(/.test(s.text))
      .map((s) => s.rel)
      .sort()
    expect(writers).toEqual(Object.keys(OTHER_WRITERS).sort())
  })
})

describe("the public app listing asks whether the Apps entry is shown", () => {
  /** Files that list published rows by their listing flag without asking, and why. */
  const NOT_APPS: Record<string, string> = {
    "lib/mcp/tools/components.ts": "Lists published COMPONENTS only (publish_type component); components are not apps and the Apps page never lists them.",
  }

  it("every file that lists published_apps by is_listed asks surfaceListsPublishedApps", () => {
    const listers = SOURCES.filter((s) => /"published_apps"/.test(s.text) && /\.\s*eq\s*\(\s*"is_listed"\s*,\s*true\s*\)/.test(s.text))
    expect(listers.length).toBeGreaterThan(0)
    const missing = listers.filter((s) => !NOT_APPS[s.rel] && !/\bsurfaceListsPublishedApps\s*\(/.test(s.text)).map((s) => s.rel)
    expect(missing).toEqual([])
    for (const rel of Object.keys(NOT_APPS)) expect(listers.map((s) => s.rel), rel).toContain(rel)
  })
})
