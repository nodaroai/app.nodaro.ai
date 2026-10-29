// @vitest-environment node
// @test-watches frontend/src/components/editor/config-panels/**/*.tsx frontend/src/components/nodes/llm-chat-quick-toolbar.tsx
/**
 * Every config-panel model menu offers only what the deployment offers.
 *
 * A model the deployment does not offer — outside its profile, denied by the
 * admin's availability override, or switched off on the models page — is
 * hidden from `GET /v1/models`, the MCP list and the quick strips, and refused
 * at run. A config panel that maps a `*_MODELS` / `*_PROVIDERS` registry
 * STRAIGHT into its `<SelectItem>`s shows it anyway: the LLM menu and most
 * audio panels did until 2026-10-29 (#2651's follow-up).
 *
 * The rule: a menu renders a registry through `useOfferedModels` (or the
 * filter it wraps, `withoutDeniedModels`), under a local name, never the
 * registry itself. This census fails any panel that maps a registry constant
 * into JSX, and the LLM menus that hand the raw `LLM_MODELS` to their grouper.
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

const PANELS = path.resolve(__dirname, "..")
const NODES = path.resolve(__dirname, "../../../nodes")
const LLM_STRIP = path.join(NODES, "llm-chat-quick-toolbar.tsx")
/** The canvas strips that render a model menu of their own (the others go through node-quick-configs, filtered there). */
const STRIPS = [LLM_STRIP, path.join(NODES, "generate-image-quick-toolbar.tsx")]

/**
 * The two shapes a registry reaches a menu in:
 * - mapped into JSX items: `X_MODELS.map((m) => (<ModelSelectOption …`;
 * - handed to a search select as its options: `options={X_MODELS}` or
 *   `options={X_MODELS.map((m) => ({ value: …` (`modelOptions=` on a strip).
 *
 * Not seen, by choice: a callback without parentheses (`m => <`), a two-
 * parameter or destructured callback, and `X.filter(…).map(` — none exist
 * today; the shape of a new menu copies a neighbour, which this census reads.
 */
const REGISTRY_INTO_JSX = /\b([A-Z0-9_]+_(?:MODELS|PROVIDERS|MODEL_OPTIONS))\.map\(\s*\(\w+\)\s*=>\s*\(?\s*</g
const REGISTRY_AS_OPTIONS = /\b(?:model)?[oO]ptions=\{\s*([A-Z0-9_]+_(?:MODELS|PROVIDERS|MODEL_OPTIONS))(?:\s*\}|\.map\()/g
/** The raw LLM registry handed to the vendor grouper a menu renders. */
const RAW_LLM_GROUPING = /groupLlmModelsByVendor\(\s*LLM_MODELS\s*\)/g

function panelFiles(): string[] {
  return fs
    .readdirSync(PANELS)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.join(PANELS, f))
}

function offendersIn(files: readonly string[], pattern: RegExp, verb: string): string[] {
  const offenders: string[] = []
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8")
    for (const m of text.matchAll(pattern)) {
      const line = text.slice(0, m.index).split("\n").length
      offenders.push(`${path.basename(file)}:${line} ${verb} ${m[1]} — render useOfferedModels(${m[1]}, <the model the select shows>) instead`)
    }
  }
  return offenders
}

describe("config-panel model menus offer only the deployment's models", () => {
  it("no panel maps a model registry straight into its menu items", () => {
    expect(offendersIn(panelFiles(), REGISTRY_INTO_JSX, "maps")).toEqual([])
  })

  it("no panel or strip hands a model registry to a select as its options", () => {
    expect(offendersIn([...panelFiles(), ...STRIPS], REGISTRY_AS_OPTIONS, "passes")).toEqual([])
  })

  it("the LLM menus group an offered list, never the raw registry", () => {
    const offenders: string[] = []
    for (const file of [...panelFiles(), ...STRIPS]) {
      const text = fs.readFileSync(file, "utf8")
      for (const m of text.matchAll(RAW_LLM_GROUPING)) {
        const line = text.slice(0, m.index).split("\n").length
        offenders.push(`${path.basename(file)}:${line} groups LLM_MODELS itself — filter it through isModelUnavailable first (keep the node's stored model)`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("the census matches the shape it guards (a sanity check on the regex)", () => {
    expect("{TTS_MODELS.map((m) => (\n  <ModelSelectOption".match(REGISTRY_INTO_JSX)).not.toBeNull()
    expect("{VIDEO_DEPTH_MODELS.map((m) => <ModelSelectOption".match(REGISTRY_INTO_JSX)).not.toBeNull()
    // A prefetch or an id list is not a menu.
    expect("prefetchModelCredits(TTS_MODELS.map((m) => m.value))".match(REGISTRY_INTO_JSX)).toBeNull()
    expect("{offeredTtsModels.map((m) => (<ModelSelectOption".match(REGISTRY_INTO_JSX)).toBeNull()
    // A registry handed to a search select, bare or mapped to option rows.
    expect("options={VIDEO_V2V_MODELS}".match(REGISTRY_AS_OPTIONS)).not.toBeNull()
    expect("modelOptions={IMAGE_GEN_MODELS}".match(REGISTRY_AS_OPTIONS)).not.toBeNull()
    expect("options={MODIFY_IMAGE_MODELS.map((m) => ({\n value: m.value".match(REGISTRY_AS_OPTIONS)).not.toBeNull()
    expect("options={offeredV2vModels}".match(REGISTRY_AS_OPTIONS)).toBeNull()
    expect("options={offeredModifyModels.map((m) => ({".match(REGISTRY_AS_OPTIONS)).toBeNull()
  })
})
