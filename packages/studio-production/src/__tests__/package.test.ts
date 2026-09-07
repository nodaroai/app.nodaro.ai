import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import * as barrel from "../index.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(HERE, "..", "..")
const REPO_ROOT = resolve(PKG_ROOT, "..", "..")

/**
 * The package's own shape, pinned from the first commit.
 *
 * `@nodaro/studio-production` is the studio's production codec running on the
 * SERVER: the routes, the MCP tools and the copilot import it inside Fastify,
 * where there is no `window`, no `import.meta.env` and no bundler alias. The
 * suite below pins the manifest facts that keep that true; the per-module scan
 * lives in `browser-free.test.ts`.
 */
describe("@nodaro/studio-production", () => {
  it("is licensed FSL — byte-for-byte the tier @nodaro/prompts carries", () => {
    const ours = readFileSync(resolve(PKG_ROOT, "LICENSE"))
    const prompts = readFileSync(resolve(REPO_ROOT, "packages/prompts/LICENSE"))
    expect(ours.equals(prompts)).toBe(true)
  })

  it("declares the FSL tier in its manifest and depends on no browser package", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(PKG_ROOT, "package.json"), "utf8"),
    ) as {
      name: string
      license: string
      type: string
      dependencies: Record<string, string>
    }
    expect(pkg.name).toBe("@nodaro/studio-production")
    expect(pkg.license).toBe("FSL-1.1-Apache-2.0")
    expect(pkg.type).toBe("module")
    // The SDK is a CONSUMER of this package, never the other way round: a
    // dependency here would invert the direction and drag a browser client
    // (Supabase, fetch wrappers) into the backend's import graph.
    expect(Object.keys(pkg.dependencies)).not.toContain("@nodaro/sdk")
    expect(Object.keys(pkg.dependencies)).not.toContain("react")
  })

  it("has a barrel, and it loads with no browser global in scope", () => {
    // The vitest environment here is `node`: no `window`, no `document`. An
    // import-time reach for either would have thrown before this line ran.
    expect(typeof barrel).toBe("object")
    expect(typeof globalThis.window).toBe("undefined")
  })
})
