/** Every affix-capable node page links the cross-cutting pre/post-text doc (Public Docs Maintenance Rule). */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { basename, join } from "node:path"
import { describe, it, expect } from "vitest"
import { PROMPT_AFFIX_NODE_TYPES } from "@nodaro/prompts"

const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const DOCS_NODES_DIR = join(REPO_ROOT, "docs/nodes")

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (e.endsWith(".md") && e !== "README.md") out.push(p)
  }
  return out
}
const pages = new Map(walk(DOCS_NODES_DIR).map((p) => [basename(p, ".md"), p]))

describe("docs: prompt pre/post text", () => {
  it("the cross-cutting page exists", () =>
    expect(existsSync(join(REPO_ROOT, "docs/prompt-pre-post-text.md"))).toBe(true))
  for (const type of [...PROMPT_AFFIX_NODE_TYPES].sort()) {
    it(`${type} page links prompt-pre-post-text.md`, () => {
      const page = pages.get(type)
      expect(page, `missing docs page for ${type}`).toBeDefined()
      expect(readFileSync(page!, "utf8")).toContain("prompt-pre-post-text.md")
    })
  }
})
