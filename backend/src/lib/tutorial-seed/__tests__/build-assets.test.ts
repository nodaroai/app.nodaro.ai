/**
 * The tutorial templates are read at RUNTIME relative to the compiled seeder
 * (`dist/lib/tutorial-seed/templates`), and `tsc` emits JavaScript only. The
 * copy step in scripts/copy-build-assets.mjs is what puts them in the image;
 * when it was missing every install booted with zero tutorials and CI stayed
 * green because the seeder swallows ENOENT. These tests pin the two things
 * that must stay true for the build to ship them:
 *   1. the manifest points at the directory the seeder actually reads, and
 *      that directory holds templates;
 *   2. the copy is a verified round-trip that FAILS on an empty or moved
 *      source rather than skipping.
 */
import { describe, it, expect } from "vitest"
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { BUILD_ASSETS, copyBuildAssets } from "../../../../scripts/copy-build-assets.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND_ROOT = resolve(HERE, "../../../..")
// Mirrors TEMPLATES_DIR in ../index.ts: `templates` beside the seeder module.
const SEEDER_TEMPLATES_DIR = resolve(HERE, "..", "templates")

describe("build assets manifest", () => {
  it("declares the directory the tutorial seeder reads from", () => {
    const declared = BUILD_ASSETS.map((a) => resolve(BACKEND_ROOT, "src", a.dir))
    expect(declared).toContain(SEEDER_TEMPLATES_DIR)
  })

  it("that directory holds at least one template, all matched by the manifest", async () => {
    const asset = BUILD_ASSETS.find((a) => resolve(BACKEND_ROOT, "src", a.dir) === SEEDER_TEMPLATES_DIR)!
    const files = await readdir(SEEDER_TEMPLATES_DIR)
    const templates = files.filter((f) => f.endsWith(".json"))
    expect(templates.length).toBeGreaterThan(0)
    for (const f of templates) expect(asset.match.test(f)).toBe(true)
  })
})

describe("copyBuildAssets", () => {
  async function scratch(): Promise<string> {
    return mkdtemp(join(tmpdir(), "nodaro-build-assets-"))
  }

  it("mirrors the declared files from src/ into dist/ and reports them", async () => {
    const root = await scratch()
    try {
      const dir = "lib/thing/templates"
      await mkdir(join(root, "src", dir), { recursive: true })
      await writeFile(join(root, "src", dir, "a.json"), "{}")
      await writeFile(join(root, "src", dir, "b.json"), "{}")
      await writeFile(join(root, "src", dir, "notes.md"), "not shipped")

      const report = await copyBuildAssets({ rootDir: root, assets: [{ dir, match: /\.json$/ }] })

      expect(report).toEqual([{ dir, files: ["a.json", "b.json"] }])
      expect((await readdir(join(root, "dist", dir))).sort()).toEqual(["a.json", "b.json"])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("fails loudly when the source directory is missing or holds no matching files", async () => {
    const root = await scratch()
    try {
      await expect(
        copyBuildAssets({ rootDir: root, assets: [{ dir: "lib/moved/templates", match: /\.json$/ }] }),
      ).rejects.toThrow(/no files matching/)

      await mkdir(join(root, "src", "lib/empty"), { recursive: true })
      await writeFile(join(root, "src", "lib/empty", "readme.md"), "")
      await expect(
        copyBuildAssets({ rootDir: root, assets: [{ dir: "lib/empty", match: /\.json$/ }] }),
      ).rejects.toThrow(/no files matching/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("fails when a copied file does not land (partial copy is a red build)", async () => {
    const root = await scratch()
    try {
      const dir = "lib/thing/templates"
      await mkdir(join(root, "src", dir), { recursive: true })
      await writeFile(join(root, "src", dir, "a.json"), "{}")
      // A file matched in src but named so the dist listing cannot see it
      // would be a script bug; simulate by making dist/<dir> a FILE so the
      // copy itself throws — the error must surface, never be swallowed.
      await mkdir(join(root, "dist", "lib/thing"), { recursive: true })
      await writeFile(join(root, "dist", dir), "not a directory")
      await expect(
        copyBuildAssets({ rootDir: root, assets: [{ dir, match: /\.json$/ }] }),
      ).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
