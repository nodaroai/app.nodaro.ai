/**
 * A published post's "View post" link appears however the node ran.
 *
 * The card and the settings panel read `platformPostUrl`. The single-node Run
 * wrote it from the publish answer; a workflow run (Execute workflow) carries
 * the same link in the node's state (`output.json`), but the lanes that paint a
 * run's node states onto the canvas, live and on reopen, never wrote it, so the
 * node said "Published" with no link. Neither did the reconcile lane, which
 * lands a publish that ended while no one was watching.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
// use-workflow-persistence builds a Supabase client only inside its hook.
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyBackendExecutionState, applyCompletedExecutionResults } from "@/hooks/use-workflow-persistence"
import { buildCompletedResultPatch } from "@/lib/reconcile-completed-jobs"
import { paintRunStates } from "../run-handlers"

type Data = Record<string, unknown>

const IG_URL = "https://www.instagram.com/p/ABC123/"
const FB_URL = "https://www.facebook.com/page-1_post-1"

function socialNode(id: string, type: string): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: type, executionStatus: "running" } } as unknown as WorkflowNode
}

/** A completed publish's node state, as the orchestrator stores it (backend output-extractor). */
function published(postId: string, postUrl: string) {
  return {
    status: "completed",
    jobId: `job-${postId}`,
    startedAt: "2026-11-27T10:00:00.000Z",
    completedAt: "2026-11-27T10:00:05.000Z",
    output: { text: postUrl, json: { platformPostId: postId, platformPostUrl: postUrl } },
  }
}

const NODES = () => [socialNode("ig", "instagram-post"), socialNode("fb", "facebook-post")]
const STATES = { ig: published("1789", IG_URL), fb: published("page-1_post-1", FB_URL) }
const dataOf = (nodes: readonly WorkflowNode[], id: string) => (nodes.find((n) => n.id === id)?.data ?? {}) as Data

/** The three lanes that paint an orchestrator run's node states onto the canvas. */
const LANES: ReadonlyArray<readonly [string, (nodes: WorkflowNode[]) => WorkflowNode[]]> = [
  [
    "the live run (syncNodeStatesToStore)",
    (nodes) => {
      act(() => useWorkflowStore.setState({ nodes, edges: [] }))
      act(() => paintRunStates(STATES as never))
      return useWorkflowStore.getState().nodes
    },
  ],
  ["a reopen while it runs (applyBackendExecutionState)", (nodes) => applyBackendExecutionState(nodes, STATES as never)],
  [
    "a reopen after it ended (applyCompletedExecutionResults)",
    (nodes) => applyCompletedExecutionResults(nodes, STATES as never, "2026-11-27T10:00:06.000Z"),
  ],
]

beforeEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

describe.each(LANES)("a workflow run's published post, through %s", (_lane, paint) => {
  it("puts the Instagram post's link on the node", () => {
    const data = dataOf(paint(NODES()), "ig")
    expect(data.executionStatus).toBe("completed")
    expect(data.platformPostUrl).toBe(IG_URL)
    expect(data.platformPostId).toBe("1789")
  })

  it("puts the Facebook post's link on the node", () => {
    const data = dataOf(paint(NODES()), "fb")
    expect(data.platformPostUrl).toBe(FB_URL)
    expect(data.platformPostId).toBe("page-1_post-1")
  })
})

describe("a publish that ended while no one watched (buildCompletedResultPatch)", () => {
  it("lands the post's link on the node", () => {
    const patch = buildCompletedResultPatch(
      "facebook-post",
      { platformPostId: "page-1_post-1", platformPostUrl: FB_URL },
      "job-1",
      "2026-11-27T10:00:06.000Z",
    )
    expect(patch).toMatchObject({ executionStatus: "completed", platformPostId: "page-1_post-1", platformPostUrl: FB_URL })
  })
})
