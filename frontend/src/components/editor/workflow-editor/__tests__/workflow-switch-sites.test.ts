/**
 * The editor leaves a workflow in place — Back or Forward, a link, a copy, a child opened — without
 * mounting again, and the workflow it loads next may hold nodes with the very same ids. Every run
 * click started on the workflow it left ends where it waits. The handlers and the hook are tested
 * on their own (run-handlers-preview-gate, render-final-handler, run-confirm-unmount); what joins
 * them is read here from the source, the editor being too large to mount in a unit test:
 * - every run handler takes its liveness from `clickLiveness` — the workflow the click was started
 *   on — never from the context's staleness alone (the editor re-points it before the next
 *   workflow loads, so it answers "live" again once that one has);
 * - the editor keys its run confirmations by the workflow it is on, so an open one is answered "no";
 * - the effect that loads the next workflow releases every node's in-flight ▶.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(__dirname, "..")
const read = (file: string) => readFileSync(join(DIR, file), "utf8")

describe("a workflow switched in place: what joins the run handlers to the editor", () => {
  it("every run handler asks clickLiveness, and none reads the context's staleness alone as its liveness", () => {
    const handlers = read("run-handlers.ts")
    // handleRun, a node's ▶, Run from here, Run up to here, Run selected.
    expect(handlers.match(/= clickLiveness\(ctx\)/g)).toHaveLength(5)
    const render = read("render-final-handler.ts")
    expect(render).toContain("const { alive } = clickLiveness(ctx)")
    for (const src of [handlers, render]) expect(src).not.toMatch(/const alive = \(\) => !ctx\.isWorkflowStale\(\)/)
  })

  it("Run from here, Run up to here and Run selected start the run on the workflow the click was started on", () => {
    const handlers = read("run-handlers.ts")
    expect(handlers.match(/const workflowId = live\.workflowId;/g)).toHaveLength(3)
    // The one read of the store's workflow left is the click's own capture, in clickLiveness.
    expect(handlers.match(/const workflowId = useWorkflowStore\.getState\(\)\.workflowId;/g)).toHaveLength(1)
  })

  it("the editor keys its confirmations by its workflow, and releases every in-flight ▶ when it loads another", () => {
    const editor = read("workflow-editor-main.tsx")
    expect(editor).toContain("useRunConfirm(workflowId)")
    const load = editor.match(/useEffect\(\(\) => \{\n\s+if \(workflowId\) \{([\s\S]*?)\n\s+load\(workflowId\)/)
    expect(load, "the effect that loads the workflow").not.toBeNull()
    expect(load![1]).toContain("releaseSingleRunGuards();")
    expect(load![1]).toContain("workflowSwitchesRef.current += 1;")
    expect(editor).toContain("workflowSwitches: () => workflowSwitchesRef.current,")
  })

  it("a click compares the editor's count of switches it took at the click", () => {
    expect(read("run-handlers.ts")).toMatch(/const switches = ctx\.workflowSwitches\?\.\(\);[\s\S]*?ctx\.workflowSwitches\?\.\(\) === switches/)
  })
})
