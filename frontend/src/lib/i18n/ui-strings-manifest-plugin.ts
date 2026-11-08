// @reads frontend/src/lib/i18n/en.ts frontend/src/lib/i18n/platform-languages.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import { runInNewContext } from "node:vm"
import { buildUiStringManifest, uiStringManifestFile, type UiStringManifest } from "@nodaro/shared/runtime-config"
import type { Plugin } from "vite"
import { FLOW_STRINGS_PRODUCT } from "./overrides"

/**
 * Build-only: leaves this app's UI-string key manifest beside its output
 * (`dist/ui-strings-manifest.flow.json`), the keys of the base dictionary with
 * their placeholder names. The server reads it at boot to check a deployment's
 * `strings` overrides (backend/src/lib/surface-strings.ts). It is derived on
 * every build, so nothing is checked in and a new string needs no extra step.
 * It holds no text, and the JS bundle already carries every key.
 *
 * The dictionaries are read as FILES and evaluated here, not imported. Anything
 * vite.config.ts imports is a config dependency, and Vite restarts the dev
 * server when one changes, so importing en.ts would turn every string edit in
 * `npm run dev` into a restart.
 */

const DICTIONARY = "src/lib/i18n/en.ts"
const LANGUAGES = "src/lib/i18n/platform-languages.ts"

/** One named export of a TypeScript module with no runtime imports. TypeScript loads here, so only a build pays for it. */
async function evaluatedExport(file: string, name: string): Promise<unknown> {
  const { default: ts } = await import("typescript")
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports: Record<string, unknown> = {}
  runInNewContext(outputText, { exports, module: { exports } })
  if (exports[name] === undefined) throw new Error(`[ui-strings-manifest] ${file} exports no \`${name}\``)
  return exports[name]
}

/** The manifest of this app's dictionaries, as they are on disk under `root` (the frontend directory). */
export async function flowUiStringManifest(root: string): Promise<UiStringManifest> {
  const dict = (await evaluatedExport(path.join(root, DICTIONARY), "en")) as Record<string, string>
  const locales = (await evaluatedExport(path.join(root, LANGUAGES), "PLATFORM_LANGUAGES")) as readonly string[]
  return buildUiStringManifest(FLOW_STRINGS_PRODUCT, dict, locales)
}

export function uiStringsManifest(options: { root: string }): Plugin {
  return {
    name: "nodaro:ui-strings-manifest",
    apply: "build",
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: uiStringManifestFile(FLOW_STRINGS_PRODUCT),
        source: JSON.stringify(await flowUiStringManifest(options.root)),
      })
    },
  }
}
