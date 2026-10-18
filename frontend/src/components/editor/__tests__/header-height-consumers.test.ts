// @vitest-environment node
// @test-watches frontend/src/components/editor/workflow-editor/workflow-editor-main.tsx frontend/src/components/editor/pipeline-panel/chat/chat-panel.tsx frontend/src/components/editor/node-toolbar.tsx
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Inside DashboardLayout, the views sized against the whole viewport subtract
 * the shared site header's height (`--ns-header-h`, published by the header,
 * absent otherwise — the `0px` fallback keeps them exactly as before).
 */

const EDITOR = join(__dirname, "..")
const read = (path: string) => readFileSync(join(EDITOR, path), "utf8")
const HEADER = "var(--ns-header-h,0px)"

describe("full-viewport views under the shared header", () => {
  it("the editor's frame is the viewport minus the header", () => {
    const src = read("workflow-editor/workflow-editor-main.tsx")
    expect(src).toContain(`h-[calc(100vh_-_${HEADER})]`)
    expect(src).not.toMatch(/className="flex flex-col h-screen"/)
  })

  it("the pipeline chat panel starts under the header", () => {
    const src = read("pipeline-panel/chat/chat-panel.tsx")
    expect(src.match(/fixed top-\[var\(--ns-header-h,0px\)\] h-\[calc\(100%_-_var\(--ns-header-h,0px\)\)\]/g) ?? []).toHaveLength(2)
    expect(src).not.toMatch(/fixed top-0 h-full/)
  })

  it("the node picker's height leaves room for the header", () => {
    expect(read("node-toolbar.tsx")).toContain(`max-h-[calc(100vh_-_6rem_-_${HEADER})]`)
  })
})
