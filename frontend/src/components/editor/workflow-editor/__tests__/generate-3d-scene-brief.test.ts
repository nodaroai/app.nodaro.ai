/**
 * Generate 3D Scene on the canvas: the brief it sends is the typed text with a
 * wired prompt APPENDED (a Video Analysis's breakdown under the author's
 * directions), or the typed text alone when it places the wired source by
 * `{Label}`; and a brief past the route's limit is refused before any request,
 * pointing at the uncapped way to author from a long video. Mirror of the
 * server's scene3d-dag cases (`promptFor("generate-3d-scene", true)`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), toast) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  generate3DScene: vi.fn(() => new Promise(() => {})),
}))

import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { generate3DScene } from "@/lib/api"
import { executeNode } from "../execute-node"

const SCENE = "scene"
const BREAKDOWN = { shots: [{ id: "s1", description: "two jets bank left over a ridge" }] }

const analysis = (json: unknown): WorkflowNode =>
  ({ id: "va", type: "video-analysis", position: { x: 0, y: 0 }, data: { label: "Video Analysis", generatedJson: json } }) as unknown as WorkflowNode
const scene = (scenePrompt: string): WorkflowNode =>
  ({ id: SCENE, type: "generate-3d-scene", position: { x: 0, y: 0 }, data: { label: "Generate 3D Scene", scenePrompt, fps: 24, durationSeconds: 4, aspectRatio: "16:9" } }) as unknown as WorkflowNode
const WIRE: WorkflowEdge[] = [{ id: "e", source: "va", target: SCENE, sourceHandle: "json", targetHandle: "prompt" } as WorkflowEdge]

function makeCtx() {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i: unknown) => i,
    untrackInterval: (i: unknown) => clearInterval(i as ReturnType<typeof setInterval>),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
  } as never
}

/** Run the scene node; resolves with the brief it sent, or undefined when it refused first. */
async function run(nodes: WorkflowNode[], edges: WorkflowEdge[] = WIRE): Promise<string | undefined> {
  act(() => useWorkflowStore.setState({ nodes, edges }))
  void executeNode(useWorkflowStore.getState().nodes.find((n) => n.id === SCENE)!, makeCtx()).catch(() => {})
  await vi.waitFor(() => {
    if ((generate3DScene as ReturnType<typeof vi.fn>).mock.calls.length === 0 && toast.error.mock.calls.length === 0) {
      throw new Error("not settled")
    }
  })
  const calls = (generate3DScene as ReturnType<typeof vi.fn>).mock.calls
  return calls.length > 0 ? (calls[0]![0] as { prompt: string }).prompt : undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})
afterEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [] }))
})

describe("Generate 3D Scene's brief on the canvas", () => {
  it("appends a wired Video Analysis to the typed directions", async () => {
    const brief = await run([analysis(BREAKDOWN), scene("Previs of this clip, grey-box only.")])
    expect(brief).toBe(`Previs of this clip, grey-box only. ${JSON.stringify(BREAKDOWN)}`)
  })

  it("sends the analysis alone when nothing is typed", async () => {
    expect(await run([analysis(BREAKDOWN), scene("")])).toBe(JSON.stringify(BREAKDOWN))
  })

  it("places it where the brief names it, and does not append it again", async () => {
    const brief = await run([analysis(BREAKDOWN), scene("Recreate {Video Analysis} as previs.")])
    expect(brief).toBe(`Recreate ${JSON.stringify(BREAKDOWN)} as previs.`)
  })

  it("refuses a brief over the limit before any request, pointing at References", async () => {
    const long = { shots: Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, description: "a long shot description" })) }
    expect(await run([analysis(long), scene("Previs.")])).toBeUndefined()
    expect(generate3DScene).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/8,000[\s\S]*References instead of its analysis/))
  })
})
