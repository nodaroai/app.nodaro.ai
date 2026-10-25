// @test-watches frontend/src/**/*.{ts,tsx}
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Where the shared site header can appear — derived from the code, not a list
 * of routes. It mounts through ONE slot, the slot is rendered by ONE layout
 * (DashboardLayout: the signed-in app), and that layout is the element of ONE
 * route in the router. So the admin layout and every route outside it — sign-in
 * and sign-up, shares, embeds, published apps, tutorials, OAuth, MCP — never
 * render it, and inside it `sharedHeaderActive()` still keeps it off embedded,
 * white-label and prepaid pages (lib/__tests__/shared-header.test.ts).
 */

const SRC = join(__dirname, "..", "..", "..")
const posix = (path: string) => path.split(sep).join("/")

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(full)
    return (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : []
  })
}

const FILES = sourceFiles(SRC).map((file) => ({ path: posix(relative(SRC, file)), src: readFileSync(file, "utf8") }))
const where = (pattern: RegExp) => FILES.filter(({ src }) => pattern.test(src)).map(({ path }) => path).sort()

describe("where the shared site header can render", () => {
  it("the slot is rendered by exactly one component: DashboardLayout", () => {
    expect(where(/<SiteHeaderSlot\b/)).toEqual(["layouts/dashboard-layout.tsx"])
  })

  it("DashboardLayout is the element of exactly one route", () => {
    const router = FILES.find(({ path }) => path === "router.tsx")?.src ?? ""
    expect(router.match(/element:\s*<DashboardLayout\s*\/>/g) ?? []).toHaveLength(1)
    expect(where(/<DashboardLayout\b/)).toEqual(["router.tsx"])
  })

  it("only the slot reaches the ee mount, and only the mount reaches the header module", () => {
    expect(where(/["']@\/ee\/shell\/app-header["']/)).toEqual(["components/layout/site-header-slot.tsx"])
    // The resolver names the id it resolves; the mount is the only importer.
    expect(where(/["']virtual:site-header["']/)).toEqual(["ee/shell/app-header.tsx", "ee/shell/header-module-plugin.ts"])
  })

  it("the shared language has its own small module, read only by the locale store and <html> mirror", () => {
    // Its own id so the main bundle never carries the header: the locale store
    // reads it at startup. A new importer must be as light as these.
    expect(where(/["']virtual:site-locale["']/)).toEqual([
      "components/i18n-html-dir.tsx",
      "ee/shell/contract/props.contract.ts",
      "ee/shell/header-module-plugin.ts",
      "lib/locale-store.ts",
    ])
  })

  it("the admin layout reads neither the slot nor the gate", () => {
    const admin = FILES.find(({ path }) => path === "ee/layouts/admin-layout.tsx")?.src ?? ""
    expect(admin).not.toMatch(/SiteHeaderSlot|sharedHeaderActive/)
  })
})
