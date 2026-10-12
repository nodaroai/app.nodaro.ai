/**
 * Every place the editor shows the sentence a UGC node failed with reads it
 * through `ugcNodeMessageText`: the node stores the shared English both
 * engines write, and the person reads it in their own language. A UGC card,
 * or a UGC toast, that shows the stored message as it is fails here.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { UGC_NODE_TYPES } from "@nodaro/shared"

const SRC = join(__dirname, "..", "..")
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")

describe("a UGC node's failure — the editor's display sites", () => {
  it("every UGC card shows its failure line, and its tooltip, through ugcNodeMessageText", () => {
    expect(UGC_NODE_TYPES.size).toBe(5)
    for (const type of UGC_NODE_TYPES) {
      const src = read(`components/nodes/${type}-node.tsx`)
      expect(src, type).toContain("{ugcNodeMessageText(d.errorMessage)}")
      expect(src, type).toContain("title={ugcNodeMessageText(d.errorMessage)}")
      expect(src, type).not.toMatch(/\{\s*d\.errorMessage\s*\}/)
    }
  })

  it("every failure toast of a canvas UGC run maps its description", () => {
    const src = read("components/editor/workflow-editor/ugc-execute.ts")
    const toasts = [...src.matchAll(/guardedToast\.error\(tx\("nodeRun\.failed".*?\{ description: (.*?) \}\)$/gm)]
    expect(toasts.length).toBe(2)
    for (const [, description] of toasts) expect(description).toMatch(/^ugcNodeMessageText\(/)
  })

  it("a refused pick says so in the person's language", () => {
    expect(read("lib/ugc-creator-run.ts")).toContain("toast.error(ugcNodeMessageText(picked.error))")
  })
})
