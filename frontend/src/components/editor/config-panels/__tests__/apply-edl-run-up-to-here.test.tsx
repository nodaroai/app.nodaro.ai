/**
 * Apply EDL's "upstream hasn't run" state (decided 2026-10-08): wired to an Edit
 * Plan that has not run, the panel says so and offers Run up to here; once the
 * plan has run, the offer goes.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

const runUpToHere = vi.fn()
const { store } = vi.hoisted(() => ({ store: { nodes: [] as unknown[], edges: [] as unknown[], runUpToHere: null as unknown } }))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign((select: (s: typeof store) => unknown) => select(store), { getState: () => store }),
}))

import { ApplyEdlConfig } from "../processing-configs"
import type { ApplyEdlData } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const wire = [{ id: "e", source: "plan", target: "render", targetHandle: "edl" }]
const PLAN = { version: 1, clock: "master", sources: [{ id: "cam", url: "https://media.test/cam.mp4", kind: "video" }], segments: [{ id: "s0", inMs: 0, outMs: 4000, video: "cam" }] }

function panel(planData: Record<string, unknown>) {
  const nodes = [node("plan", "edit-plan", planData), node("render", "apply-edl")]
  store.nodes = nodes
  store.edges = wire
  store.runUpToHere = runUpToHere
  render(<ApplyEdlConfig data={{} as ApplyEdlData} onUpdate={() => {}} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={nodes as never} edges={wire as never} nodeId="render" />)
}

afterEach(() => {
  cleanup()
  runUpToHere.mockClear()
})

describe("the Apply EDL panel, upstream not run", () => {
  it("offers Run up to here, and a click hands the render node to the editor's action", () => {
    panel({})
    expect(screen.getByTestId("run-up-to-here-notice")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Run up to here/ }))
    expect(runUpToHere).toHaveBeenCalledWith("render")
  })

  it("offers nothing once the plan has run", () => {
    panel({ generatedJson: PLAN })
    expect(screen.queryByTestId("run-up-to-here-notice")).toBeNull()
  })
})
