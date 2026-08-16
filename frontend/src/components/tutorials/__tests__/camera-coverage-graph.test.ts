import { describe, it, expect } from "vitest"
// The seeded template itself, imported so the path is resolved at build time
// rather than against whatever directory the runner happens to start in.
import seed from "../../../../../backend/src/lib/tutorial-seed/templates/camera-coverage.json"
import { deriveCoverageGraph } from "../bodies/camera-coverage-graph"
import { SHOT_KINDS, kindFor } from "../bodies/camera-coverage-content"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode

const edge = (source: string, target: string, sourceHandle?: string, targetHandle?: string) =>
  ({ id: `${source}-${target}`, source, target, sourceHandle, targetHandle }) as unknown as WorkflowEdge

/** A minimal coverage chain with different ids than the seed — the roles must
 *  be found from types + wiring, never from ids or labels. */
function chain() {
  return {
    nodes: [
      node("p", "text-prompt", { text: "a woman at a window" }),
      node("img", "generate-image", { generatedImageUrl: "https://cdn/anchor.png", provider: "gpt-image-2", aspectRatio: "3:2" }),
      node("brief", "text-prompt", { text: "write 3 shots" }),
      node("llm", "llm-chat", { llmModel: "gpt-5.2", generatedText: "wide\nmedium\nclose" }),
      node("split", "split-text", { splitResults: ["wide", "medium", "close"] }),
      node("list", "list", { rows: [[""]], columns: [{ id: "default", handleId: "col_default", type: "text" }] }),
      node("shot", "generate-image", {
        label: "Shot",
        provider: "gpt-image-2",
        generatedResults: [{ url: "https://cdn/1.png" }, { url: "https://cdn/2.png" }, { url: "https://cdn/3.png" }],
      }),
    ],
    edges: [
      edge("p", "img", "prompt", "prompt"),
      edge("img", "llm", "image", "references"),
      edge("brief", "llm", "prompt", "prompt"),
      edge("llm", "split", "text", "text"),
      edge("split", "list", "text", "col_default_in"),
      edge("list", "shot", "col_default", "prompt"),
      edge("img", "shot", "image", "references"),
    ],
  }
}

describe("deriveCoverageGraph", () => {
  it("finds every role structurally — by type and wiring, not id", () => {
    const g = deriveCoverageGraph(chain().nodes, chain().edges)
    expect(g.anchor?.nodeId).toBe("img")
    expect(g.anchor?.prompt).toBe("a woman at a window")
    expect(g.anchor?.imageUrl).toBe("https://cdn/anchor.png")
    expect(g.anchor?.aspectRatio).toBe("3:2")
    expect(g.brief?.nodeId).toBe("brief")
    expect(g.planner?.nodeId).toBe("llm")
    expect(g.planner?.model).toBe("gpt-5.2")
    expect(g.fanOut?.nodeId).toBe("shot")
    expect(g.fanOut?.count).toBe(3)
  })

  it("pairs each shot line with the image at the same position", () => {
    const g = deriveCoverageGraph(chain().nodes, chain().edges)
    expect(g.shots.map((s) => [s.index, s.line, s.imageUrl])).toEqual([
      [1, "wide", "https://cdn/1.png"],
      [2, "medium", "https://cdn/2.png"],
      [3, "close", "https://cdn/3.png"],
    ])
  })

  // The anchor is the image that feeds BOTH the planner and the fan-out. A
  // second image wired only into the fan-out's references (an extra style
  // ref) must not steal the role, whatever order the nodes are in.
  it("picks the image feeding both the planner and the fan-out as the anchor, not a stray reference", () => {
    const c = chain()
    c.nodes.unshift(node("style", "generate-image", { generatedImageUrl: "https://cdn/style.png" }))
    c.edges.push(edge("style", "shot", "image", "references"))
    const g = deriveCoverageGraph(c.nodes, c.edges)
    expect(g.anchor?.nodeId).toBe("img")
    expect(g.anchor?.imageUrl).toBe("https://cdn/anchor.png")
  })

  it("keeps the line when a shot has not been generated yet", () => {
    const c = chain()
    const shot = c.nodes.find((n) => n.id === "shot")!
    ;(shot.data as Record<string, unknown>).generatedResults = [{ url: "https://cdn/1.png" }]
    const g = deriveCoverageGraph(c.nodes, c.edges)
    expect(g.shots).toHaveLength(3)
    expect(g.shots[2]).toEqual({ index: 3, line: "close", imageUrl: null })
  })

  it("returns an empty shape for an unrelated graph instead of throwing", () => {
    const g = deriveCoverageGraph([node("t", "text-prompt", { text: "x" })], [])
    expect(g.anchor).toBeNull()
    expect(g.fanOut).toBeNull()
    expect(g.shots).toEqual([])
  })
})

// The lesson is written against the seeded template. If the template is
// re-published in a shape the derivation can no longer read, this is where it
// shows — before a user opens a tutorial with an empty contact sheet.
describe("camera-coverage seed template", () => {
  const g = deriveCoverageGraph(seed.nodes as unknown as WorkflowNode[], seed.edges as unknown as WorkflowEdge[])

  it("has an anchor frame with a prompt and a finished image", () => {
    expect(g.anchor?.prompt).toMatch(/\S/)
    expect(g.anchor?.imageUrl).toMatch(/^https:\/\//)
  })

  it("has a brief, a planner and a fan-out image node", () => {
    expect(g.brief?.text).toMatch(/10 image prompts/i)
    expect(g.planner?.model).toBeTruthy()
    expect(g.fanOut).not.toBeNull()
  })

  it("carries all ten shots, each with its line and its finished image", () => {
    expect(g.shots).toHaveLength(10)
    for (const s of g.shots) {
      expect(s.line).toMatch(/\S/)
      expect(s.imageUrl).toMatch(/^https:\/\//)
    }
  })

  // The kinds are authored by POSITION (the brief fixes the coverage order), so
  // a re-published run that changes the order would mislabel shots without
  // this: each label's leading word must appear in the line it names.
  it("names every shot position, and each name matches the line it labels", () => {
    expect(SHOT_KINDS).toHaveLength(g.shots.length)
    for (const s of g.shots) {
      const kind = kindFor(s.index)
      const lead = kind.split(/[,\s]/)[0].toLowerCase()
      expect(kind).toMatch(/\S/)
      expect(s.line.toLowerCase()).toContain(lead)
    }
    // Past the authored range the label is a plain fallback, never undefined.
    expect(kindFor(SHOT_KINDS.length + 1)).toBe(`Shot ${SHOT_KINDS.length + 1}`)
  })

  it("reads the frame's aspect ratio for the column meta", () => {
    expect(g.anchor?.aspectRatio).toBe("16:9")
  })

  it("names the four stages with headings a newcomer can read (no jargon)", () => {
    const labels = (seed.nodes as Array<{ type: string; data: { label?: string } }>)
      .filter((n) => n.type === "group")
      .map((n) => n.data.label ?? "")
    expect(labels).toHaveLength(4)
    for (const l of labels) expect(l).not.toMatch(/\bDP\b/)
  })
})
