// @test-watches frontend/src/ee/shell/header-module-plugin.ts frontend/src/ee/shell/install-package.sh
/**
 * The product list is the deployment's setting, parsed here. The two files
 * the page reads for a `site-file` product are written by other code: the
 * site's `shell-version.json` by the Vite plugin, the pin by the install
 * script — a rename on either side would leave the page reading nothing.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parseHeaderProducts, PIN_FILE, SITE_FILE } from "../products.js"
import { versionFromPin } from "../read-version.js"

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..")
const readRepoFile = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8")

const entry = (over: Record<string, unknown> = {}) => ({
  id: "tools",
  label: "tools",
  repo: "acme/tools",
  production: "tools.example.com",
  staging: "next.tools.example.com",
  source: "lockfile",
  ...over,
})

describe("parseHeaderProducts", () => {
  it("reads the deployment's list, hosts grouped by environment", () => {
    const parsed = parseHeaderProducts(JSON.stringify([entry(), entry({ id: "app", label: "App", repo: "acme/app", production: "App.Example.com", staging: "next.example.com", source: "site-file" })]))
    expect(parsed.invalid).toEqual([])
    expect(parsed.products).toEqual([
      { id: "tools", label: "tools", repo: "acme/tools", hosts: { production: "tools.example.com", staging: "next.tools.example.com" }, source: "lockfile" },
      { id: "app", label: "App", repo: "acme/app", hosts: { production: "app.example.com", staging: "next.example.com" }, source: "site-file" },
    ])
  })

  it("no setting lists nothing and refuses nothing", () => {
    expect(parseHeaderProducts(undefined)).toEqual({ products: [], invalid: [] })
    expect(parseHeaderProducts("  ")).toEqual({ products: [], invalid: [] })
  })

  it("a bad entry is refused alone; a host is a bare name, never a URL", () => {
    const parsed = parseHeaderProducts(
      JSON.stringify([entry({ production: "https://tools.example.com" }), entry({ id: "voice", repo: "not a repo" }), entry({ id: "person", source: "magic" }), entry({ id: "ok" }), entry({ id: "ok" })]),
    )
    expect(parsed.products.map((p) => p.id)).toEqual(["ok"])
    expect(parsed.invalid.map((i) => i.index)).toEqual([0, 1, 2, 4])
    expect(parsed.invalid[0]?.reason).toMatch(/^production:/)
    expect(parsed.invalid[3]?.reason).toBe('id "ok" is repeated')
  })

  it("text that is not a JSON array lists nothing and says why", () => {
    expect(parseHeaderProducts("{not json")).toEqual({ products: [], invalid: [{ index: -1, reason: "HEADER_VERSIONS_PRODUCTS is not valid JSON." }] })
    expect(parseHeaderProducts('{"id":"tools"}').invalid).toEqual([{ index: -1, reason: "HEADER_VERSIONS_PRODUCTS must be a JSON array." }])
  })
})

describe("the files a site-file product is read from", () => {
  it("the site file is the one the App's build writes", () => {
    const plugin = readRepoFile("frontend/src/ee/shell/header-module-plugin.ts")
    expect(plugin).toContain(`export const SITE_VERSION_FILE = "${SITE_FILE}"`)
  })

  it("the pin file is where the App pins its header, in the form the page reads", () => {
    expect(versionFromPin(readRepoFile(PIN_FILE))).toMatch(/^\d+\.\d+\.\d+/)
  })
})
