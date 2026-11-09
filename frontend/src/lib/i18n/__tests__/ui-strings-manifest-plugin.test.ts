// @vitest-environment node
// @test-watches frontend/vite.config.ts frontend/src/lib/i18n/ui-strings-manifest-plugin.ts
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildUiStringManifest, uiStringManifestFile, type UiStringManifest } from "@nodaro/shared/runtime-config"
import { beforeAll, describe, it, expect } from "vitest"
import { en } from "../en"
import { PLATFORM_LANGUAGES } from "../platform-languages"
import { uiStringsManifest } from "../ui-strings-manifest-plugin"

/**
 * The Vite plugin that leaves the UI-string key manifest beside the build's
 * output. What it emits is held to the dictionaries as this process evaluates
 * them, generated in memory on every run, so adding a string changes nothing
 * here.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(HERE, "..", "..", "..", "..")

type Emitted = { type: string; fileName: string; source: string }

async function emit(): Promise<Emitted[]> {
  const files: Emitted[] = []
  const plugin = uiStringsManifest({ root: FRONTEND })
  const hook = plugin.generateBundle as unknown as (this: { emitFile: (f: Emitted) => void }) => Promise<void>
  await hook.call({ emitFile: (f) => files.push(f) })
  return files
}

describe("the emitted key manifest", () => {
  let files: Emitted[]
  // It compiles and evaluates the whole dictionary: seconds on a loaded machine.
  beforeAll(async () => {
    files = await emit()
  }, 60_000)

  it("is one asset, named by the contract, at the root of the build's output", () => {
    expect(files).toHaveLength(1)
    expect(files[0].type).toBe("asset")
    expect(files[0].fileName).toBe(uiStringManifestFile("flow"))
    expect(files[0].fileName).not.toContain("/")
  })

  it("matches the dictionaries: every key with visible text, its placeholders, the languages Flow offers", () => {
    const manifest = JSON.parse(files[0].source) as UiStringManifest
    expect(manifest).toEqual(buildUiStringManifest("flow", en, PLATFORM_LANGUAGES))

    // Stated without the builder, so a bug in it cannot agree with itself.
    const visible = Object.entries(en as Record<string, string>).filter(([, text]) => text.trim() !== "")
    expect(Object.keys(manifest.keys).sort()).toEqual(visible.map(([key]) => key).sort())
    for (const [key, text] of visible) {
      const names = [...new Set(Array.from(text.matchAll(/\{(\w+)\}/g), (m) => m[1]))].sort()
      expect(manifest.keys[key], key).toEqual(names)
    }
    expect(manifest.product).toBe("flow")
    expect(manifest.locales).toEqual([...PLATFORM_LANGUAGES])
  })

  it("carries no dictionary text", () => {
    expect(files[0].source).toContain('"credits.allowanceExceeded":[]')
    expect(files[0].source).not.toContain(en["credits.allowanceExceeded"])
  })

  it("runs only in a build, and vite.config.ts registers it", () => {
    expect(uiStringsManifest({ root: FRONTEND }).apply).toBe("build")
    const config = readFileSync(resolve(FRONTEND, "vite.config.ts"), "utf8")
    expect(config).toMatch(/uiStringsManifest\(\{ root: __dirname \}\)/)
  })

  it("does not import a dictionary: vite.config.ts would make it a config dependency, and every string edit a dev-server restart", () => {
    const source = readFileSync(resolve(HERE, "..", "ui-strings-manifest-plugin.ts"), "utf8")
    expect(source).not.toMatch(/from\s+["']\.\/(?:en|he|ja|ko|pt-br|dicts|platform-languages)["']/)
  })
})
