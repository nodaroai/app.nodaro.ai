/**
 * Publishing empties a node in a UGC strip set to its configuration, read as an allowlist
 * (`nodeSettingKeys`, @nodaro/render-rules): a key no rule names goes. So every key the shipped
 * tutorial templates' nodes hold must be named — configuration, or something a node holds (a run's
 * result, its own value, an input copy, a library pointer). A key that is neither is a setting the
 * node's data type does not declare: declare it, or list it in `EXTRA_NODE_SETTINGS`, before a
 * published app loses it.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { isHeldKey, isNodeSetting } from "@nodaro/render-rules"

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "tutorial-seed", "templates")

describe("every key a tutorial template's node holds is named", () => {
  const files = readdirSync(TEMPLATES).filter((f) => f.endsWith(".json"))

  it("finds the templates (a moved folder must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it.each(files)("%s", (file) => {
    const doc = JSON.parse(readFileSync(join(TEMPLATES, file), "utf8")) as { nodes?: Array<{ id: string; type: string; data?: Record<string, unknown> }> }
    const unnamed: string[] = []
    for (const node of doc.nodes ?? []) {
      for (const key of Object.keys(node.data ?? {})) {
        if (!isNodeSetting(key, node.type) && !isHeldKey(key, node.type)) unnamed.push(`${node.type}.${key}`)
      }
    }
    expect([...new Set(unnamed)].sort()).toEqual([])
  })
})
