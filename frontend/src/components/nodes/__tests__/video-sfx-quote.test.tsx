/**
 * The Video SFX node's OWN price (its quick toolbar's Run button) quotes the
 * row the listing, the server's estimate, the confirm dialog and the workflow
 * badge quote: on a render's output, the row for the length the graph gives
 * the video (decided 2026-10-07), not the 8-second row of an unmeasured clip.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { videoSfxCreditId } from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(
  readFileSync(join(HERE, "../../../../../backend/src/lib/tutorial-seed/__tests__/fixtures/run-estimate-parity.json"), "utf8"),
) as { prices: Record<string, number> }

const store = vi.hoisted(() => ({ state: { nodes: [] as unknown[], edges: [] as unknown[], updateNodeData: () => {}, runSingleNode: () => {} } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) => selector(store.state),
}))
vi.mock("@xyflow/react", () => ({
  useStore: (selector: (s: { transform: number[] }) => unknown) => selector({ transform: [0, 0, 1] }),
}))
// The price table the server half pins; an id it does not hold prices to 0 and fails the assertion.
vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: (id: string | undefined) => (id ? fixture.prices[id] ?? 0 : 0),
}))
vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: Record<string, unknown>) => <div data-testid="run" data-credits={String(props.credits)} />,
}))
vi.mock("../prompt-edit-button", () => ({ PromptEditButton: () => null }))

import { VideoSfxQuickToolbar } from "../video-sfx-quick-toolbar"

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const edge = (source: string, target: string, targetHandle: string, sourceHandle?: string): WorkflowEdge =>
  ({ id: `${source}-${target}`, source, target, targetHandle, sourceHandle }) as WorkflowEdge

function trailerRenderGraph(extra: WorkflowNode[] = [], extraEdges: WorkflowEdge[] = []) {
  store.state.nodes = [
    node("rec", "upload-video"),
    node("plan", "edit-plan", { mode: "trailer", planTier: "standard" }),
    node("render", "apply-edl", { quality: "final" }),
    node("sfx", "video-sfx"),
    ...extra,
  ]
  store.state.edges = [
    edge("rec", "plan", "sources"),
    edge("plan", "render", "edl", "edl"),
    edge("render", "sfx", "video"),
    ...extraEdges,
  ]
}

const credits = (versions = 1) => {
  const { unmount } = render(<VideoSfxQuickToolbar nodeId="sfx" data={{ versions } as never} isRunning={false} />)
  const v = Number(screen.getByTestId("run").getAttribute("data-credits"))
  unmount()
  return v
}

describe("Video SFX quick toolbar price", () => {
  it("on a trailer render quotes the render's 2-minute row, as the estimates do", () => {
    trailerRenderGraph()
    expect(credits()).toBe(fixture.prices[videoSfxCreditId(120)])
    expect(credits()).not.toBe(fixture.prices[videoSfxCreditId(8)])
  })
  it("multiplies that row by the versions", () => {
    trailerRenderGraph()
    expect(credits(3)).toBe(fixture.prices[videoSfxCreditId(120)]! * 3)
  })
  it("keeps the upstream video's own reported length where the graph tells none", () => {
    store.state.nodes = [node("up", "upload-video", { duration: 25 }), node("sfx", "video-sfx")]
    store.state.edges = [edge("up", "sfx", "video")]
    expect(credits()).toBe(fixture.prices[videoSfxCreditId(25)])
  })
  it("with nothing wired quotes the 8-second row", () => {
    store.state.nodes = [node("sfx", "video-sfx")]
    store.state.edges = []
    expect(credits()).toBe(fixture.prices[videoSfxCreditId(8)])
  })
})
