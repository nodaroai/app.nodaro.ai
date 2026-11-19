import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { NON_EN_LOCALE_IDS, type LocaleCatalogMap } from "../i18n/types.js"
import { STYLE_SIDECAR_LOADERS } from "../i18n/style-sidecar-loaders.js"

const I18N_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "i18n")

describe("STYLE_SIDECAR_LOADERS", () => {
  it("has one loader per style sidecar file, and one per non-English language", () => {
    const files = readdirSync(I18N_DIR).filter((f) => /^style\.[\w-]+\.ts$/.test(f))
    expect(Object.keys(STYLE_SIDECAR_LOADERS).sort()).toEqual(files.map((f) => `./${f}`).sort())
    expect(Object.keys(STYLE_SIDECAR_LOADERS).sort()).toEqual(NON_EN_LOCALE_IDS.map((l) => `./style.${l}.ts`).sort())
  })

  it("each loader answers its own language's sidecar", async () => {
    const labels: Record<string, string> = {}
    for (const [key, load] of Object.entries(STYLE_SIDECAR_LOADERS)) {
      const mod = (await load()) as { default: LocaleCatalogMap }
      const label = mod.default.watercolor?.label
      expect(typeof label, key).toBe("string")
      labels[key] = label ?? ""
    }
    expect(labels["./style.he.ts"]).toBe("צבעי מים")
    expect(labels["./style.ja.ts"]).toBe("水彩画")
    expect(labels["./style.pt-BR.ts"]).toBe("Aquarela")
  })
})
