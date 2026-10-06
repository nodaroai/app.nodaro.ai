import { describe, expect, it } from "vitest"
import { formatExecutionResult, mediaOfOutput, summarizeNodeStates } from "../execution-result.js"
import type { NodeExecutionState } from "../../services/workflow-engine/types.js"

/**
 * One reading of a run's node states for every machine client — the API
 * token's result, MCP get_app_run and diagnose_run.
 */
const nodes = [
  { id: "feed", type: "telegram-channel-feed", data: { label: "Tech news" } },
  { id: "llm", type: "llm-chat", data: { label: "Writer" } },
  { id: "img", type: "generate-image", data: { label: "Cover" } },
  { id: "tts", type: "text-to-speech", data: { label: "Voice" } },
]

const states: Record<string, NodeExecutionState> = {
  feed: { status: "completed", nodeType: "telegram-channel-feed", output: { text: "" } },
  llm: { status: "skipped", nodeType: "llm-chat", skipReason: "empty_input" },
  img: {
    status: "completed",
    nodeType: "generate-image",
    jobId: "job-1",
    output: { imageUrl: "https://cdn.test/a.png", imageUrls: ["https://cdn.test/a.png", "https://cdn.test/b.png"], listResults: ["https://cdn.test/c.mp4", "not a url"] },
  },
  tts: { status: "failed", nodeType: "text-to-speech", error: "no voice" },
  ghost: { status: "completed", nodeType: "combine-text", output: { text: "x".repeat(20) } },
}

describe("summarizeNodeStates", () => {
  it("follows the workflow's node order, names each node by its label, and lists states for nodes not in the graph last", () => {
    const out = summarizeNodeStates(states, nodes)
    expect(out.map((s) => s.nodeId)).toEqual(["feed", "llm", "img", "tts", "ghost"])
    expect(out.map((s) => s.label)).toEqual(["Tech news", "Writer", "Cover", "Voice", "combine-text"])
  })

  it("carries the skip reason, the error and the job id, each only when present", () => {
    const byId = Object.fromEntries(summarizeNodeStates(states, nodes).map((s) => [s.nodeId, s]))
    expect(byId.llm).toMatchObject({ status: "skipped", skipReason: "empty_input" })
    expect("error" in byId.llm!).toBe(false)
    expect(byId.tts).toMatchObject({ status: "failed", error: "no voice" })
    expect(byId.img!.jobId).toBe("job-1")
    expect("jobId" in byId.feed!).toBe(false)
  })

  it("lists EVERY media URL once, typed, including the per-iteration results — and never a non-URL", () => {
    const img = summarizeNodeStates(states, nodes).find((s) => s.nodeId === "img")!
    expect(img.media).toEqual([
      { kind: "image", url: "https://cdn.test/a.png" },
      { kind: "image", url: "https://cdn.test/b.png" },
      { kind: "video", url: "https://cdn.test/c.mp4" },
    ])
    expect(mediaOfOutput(undefined)).toEqual([])
  })

  it("cuts the text at the limit and says so; an empty text is no text", () => {
    const out = summarizeNodeStates(states, nodes, { textLimit: 5 })
    const ghost = out.find((s) => s.nodeId === "ghost")!
    expect(ghost.text).toBe("xxxxx")
    expect(ghost.textTruncated).toBe(true)
    const feed = out.find((s) => s.nodeId === "feed")!
    expect("text" in feed).toBe(false)
  })
})

describe("formatExecutionResult", () => {
  const execution = {
    status: "completed",
    node_states: states,
    total_credits_used: 3,
    created_at: "2026-10-06T10:00:00Z",
    completed_at: "2026-10-06T10:00:12Z",
    error_message: null,
  }

  it("names the outcome of a completed run and keeps the output-node shape", () => {
    const result = formatExecutionResult("exec-1", execution, nodes as never)
    expect(result.outcome).toBe("nothing_new")
    expect(result.durationMs).toBe(12_000)
    expect(result.creditsUsed).toBe(3)
    expect(result.outputs.every((o) => typeof o.nodeId === "string")).toBe(true)
  })

  it("has no outcome while the run is going", () => {
    const result = formatExecutionResult("exec-1", { ...execution, status: "running", completed_at: null }, nodes as never)
    expect("outcome" in result).toBe(false)
    expect(result.durationMs).toBeUndefined()
  })
})
