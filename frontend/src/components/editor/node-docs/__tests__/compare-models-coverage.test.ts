import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { NODE_DOCS_SECTIONS } from "@/lib/node-docs/node-docs-map.generated"

/**
 * A node whose docs page compares its models shows "Compare models ↗" beside
 * its model picker's heading. The shared provider heading
 * (`<MappableField field="provider">`) carries it for free; a panel that builds
 * its own model heading renders `<CompareModelsLink />` there. This file finds
 * each such node's config component and checks that one of the two is in it,
 * so a new model picker, or a page that gains a Models section, is not missed.
 */

/** Nodes whose page has a Models section but whose panel offers no model choice. */
const NO_MODEL_PICKER: Readonly<Record<string, string>> = {
  "audio-isolation": "one model; the panel has no model picker",
  "forced-alignment": "one model; the panel has no model picker",
  "text-to-dialogue": "ElevenLabs Dialogue v3 only; the panel has no model picker",
}

const editorDir = join(__dirname, "..", "..")
const panelSource = readFileSync(join(editorDir, "config-panel.tsx"), "utf-8")
const configDir = join(editorDir, "config-panels")
const configFiles = (readdirSync(configDir, { recursive: true }) as string[])
  .filter((f) => f.endsWith(".tsx") && !f.includes("__tests__"))
  .map((f) => readFileSync(join(configDir, f), "utf-8").split("\n"))

/** The component config-panel.tsx renders for a node type. */
function componentOf(type: string): string {
  const match = panelSource.match(new RegExp(`case "${type}":[^<]*<([A-Z]\\w+)`))
  if (!match) throw new Error(`config-panel.tsx renders no component for "${type}"`)
  return match[1]
}

/** The source of a config component: its Impl when it is a memo wrapper, up to the next top-level declaration. */
function bodyOf(name: string): string {
  for (const start of [new RegExp(`^(export )?function ${name}Impl\\(`), new RegExp(`^(export )?function ${name}\\(`)]) {
    for (const lines of configFiles) {
      const from = lines.findIndex((l) => start.test(l))
      if (from < 0) continue
      const to = lines.findIndex((l, i) => i > from && /^(export )?(function|const|class) /.test(l))
      return lines.slice(from, to < 0 ? undefined : to).join("\n")
    }
  }
  throw new Error(`no source found for ${name}`)
}

const hasLink = (body: string) => /<MappableField\s+field="provider"/.test(body) || body.includes("<CompareModelsLink")
const modelPages = Object.keys(NODE_DOCS_SECTIONS).filter((t) => NODE_DOCS_SECTIONS[t].includes("models"))

describe("Compare models", () => {
  it("sits beside the model picker of every node whose docs page compares models", () => {
    const missing = modelPages.filter((t) => !(t in NO_MODEL_PICKER) && !hasLink(bodyOf(componentOf(t))))
    expect(
      missing,
      'put the model heading in <MappableField field="provider">, render <CompareModelsLink /> beside it, or list the node in NO_MODEL_PICKER',
    ).toEqual([])
  })

  it("lists in NO_MODEL_PICKER only nodes whose page compares models and whose panel has no picker", () => {
    const stale = Object.keys(NO_MODEL_PICKER).filter((t) => {
      if (!modelPages.includes(t)) return true
      const body = bodyOf(componentOf(t))
      return hasLink(body) || /<(ModelSearchSelect|LlmModelSelect|MultiProviderPicker)\b/.test(body)
    })
    expect(stale, "the node has a model picker now, or its page no longer has Models: drop it from NO_MODEL_PICKER").toEqual([])
  })
})
