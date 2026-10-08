/**
 * The archive of past builds' styling files: each boot copies the build's
 * CSS, fonts and images once, by name — a name is its content — and nothing
 * else; scripts and the app shell are never kept. It is on for Cloud unless
 * SITE_ASSET_ARCHIVE says otherwise, and never without storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const state = vi.hoisted(() => ({ storage: true, edition: "cloud", nodeEnv: "production", archive: "auto" as "auto" | "on" | "off" }))

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>()
  return {
    ...actual,
    config: new Proxy(actual.config, {
      get: (target, key) => (key === "SITE_ASSET_ARCHIVE" ? state.archive : key === "NODE_ENV" ? state.nodeEnv : Reflect.get(target, key)),
    }),
    isCloud: () => state.edition === "cloud",
  }
})
vi.mock("../storage.js", () => ({
  isStorageConfigured: () => state.storage,
  listObjectsByPrefix: vi.fn(),
  uploadLocalFileToR2Key: vi.fn(),
}))

import { archiveSiteAssets, siteAssetArchiveEnabled } from "../site-asset-archive.js"
import { siteAssetKey, siteAssetType } from "../site-asset-keys.js"

let build: string

beforeEach(() => {
  state.storage = true
  state.edition = "cloud"
  state.nodeEnv = "production"
  state.archive = "auto"
  build = mkdtempSync(join(tmpdir(), "site-assets-"))
  mkdirSync(join(build, "assets"))
})
afterEach(() => rmSync(build, { recursive: true, force: true }))

const write = (...names: string[]) => names.forEach((name) => writeFileSync(join(build, "assets", name), name))

function store(archived: string[] = [], failing: string[] = []) {
  const uploaded: Array<{ key: string; type: string; file: string }> = []
  return {
    uploaded,
    listKeys: vi.fn(async () => archived),
    upload: vi.fn(async (file: string, key: string, type: string) => {
      if (failing.some((name) => key.endsWith(name))) throw new Error("storage said no")
      uploaded.push({ key, type, file })
    }),
  }
}

describe("archiveSiteAssets", () => {
  it("copies the build's styling files the archive does not have yet, each with its type — never a script, a source map or the shell", async () => {
    write("index-NewBuild.css", "geist-Ab12.woff2", "logo-Cd34.svg", "hero-Ef56.webp", "index-NewBuild.js", "index-NewBuild.js.map", "index.html")
    const s = store([siteAssetKey("geist-Ab12.woff2")])
    expect(await archiveSiteAssets(build, s)).toEqual({ files: 4, added: 3, failed: 0 })
    expect(s.listKeys).toHaveBeenCalledWith("site-assets/assets/")
    expect(s.uploaded.map(({ key, type }) => [key, type]).sort()).toEqual([
      ["site-assets/assets/hero-Ef56.webp", "image/webp"],
      ["site-assets/assets/index-NewBuild.css", "text/css; charset=utf-8"],
      ["site-assets/assets/logo-Cd34.svg", "image/svg+xml"],
    ])
    expect(s.uploaded.find(({ key }) => key.endsWith(".css"))?.file).toBe(join(build, "assets", "index-NewBuild.css"))
  })

  it("a build already archived copies nothing", async () => {
    write("index-NewBuild.css")
    const s = store([siteAssetKey("index-NewBuild.css")])
    expect(await archiveSiteAssets(build, s)).toEqual({ files: 1, added: 0, failed: 0 })
    expect(s.upload).not.toHaveBeenCalled()
  })

  it("a file storage refuses is counted and the rest still go in", async () => {
    write("a-1.css", "b-2.css", "c-3.css", "d-4.css", "e-5.css")
    const s = store([], ["c-3.css"])
    expect(await archiveSiteAssets(build, s)).toEqual({ files: 5, added: 4, failed: 1, firstError: "storage said no" })
    expect(s.uploaded).toHaveLength(4)
  })

  it("no build here (a dev checkout) asks storage nothing", async () => {
    rmSync(join(build, "assets"), { recursive: true })
    const s = store()
    expect(await archiveSiteAssets(build, s)).toEqual({ files: 0, added: 0, failed: 0 })
    expect(s.listKeys).not.toHaveBeenCalled()
  })
})

describe("siteAssetType", () => {
  it("names a styling file's type from its extension", () => {
    expect(siteAssetType("index-Dz56B_55.css")).toBe("text/css; charset=utf-8")
    expect(siteAssetType("KaTeX_Main-Regular.B22Nviop.woff2")).toBe("font/woff2")
    expect(siteAssetType("photo-1a2b.JPG")).toBe("image/jpeg")
  })

  it("holds nothing else: scripts, the shell, other folders, a way up", () => {
    for (const name of ["index-Dz56B_55.js", "index.html", "chunk.js.map", "data.json", "../secret.css", "a/b.css", ".hidden.css", "a..b.css", ""]) {
      expect(siteAssetType(name), name).toBeNull()
    }
  })
})

describe("siteAssetArchiveEnabled", () => {
  it("auto: on for a production Cloud server, off for the other editions", () => {
    expect(siteAssetArchiveEnabled()).toBe(true)
    state.edition = "community"
    expect(siteAssetArchiveEnabled()).toBe(false)
  })

  it("auto: never on a developer's checkout, whose settings say Cloud too", () => {
    state.nodeEnv = "development"
    expect(siteAssetArchiveEnabled()).toBe(false)
  })

  it("on and off decide for any edition", () => {
    state.edition = "community"
    state.archive = "on"
    expect(siteAssetArchiveEnabled()).toBe(true)
    state.edition = "cloud"
    state.archive = "off"
    expect(siteAssetArchiveEnabled()).toBe(false)
  })

  it("never without storage", () => {
    state.storage = false
    state.archive = "on"
    expect(siteAssetArchiveEnabled()).toBe(false)
  })
})
