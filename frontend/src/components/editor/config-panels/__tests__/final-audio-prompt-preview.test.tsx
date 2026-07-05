import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { getEffectiveSunoCustomMode } from "@nodaro/prompts"
import { collectAudioStyleHints } from "@/lib/audio-style-hints"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { FinalAudioPromptPreview } from "../final-audio-prompt-preview"

/**
 * Task 3 — the suno-generate Final preview is a pass-through of the shared
 * `assembleSunoInput` and shows EVERY field (prompt + style + lyrics + title +
 * negativeStyle + folded pickers). Guards the two user complaints:
 *   1. typed Style/Lyrics/Title/Negative were invisible in the preview;
 *   4. the Final preview rendered NOTHING (null guard) unless a connected
 *      audio-style picker produced hint text — so a node with only typed fields
 *      showed an empty preview.
 */

const sunoNode = (data: Record<string, unknown>): WorkflowNode =>
  ({ id: "s1", type: "suno-generate", position: { x: 0, y: 0 }, data: { label: "Suno", ...data } } as unknown as WorkflowNode)

/** A music-genre audio-style source + the edge wiring it to the suno consumer. */
const genreNode: WorkflowNode =
  ({ id: "genre", type: "music-genre", position: { x: 0, y: 0 }, data: { label: "Genre", genre: "electronic" } } as unknown as WorkflowNode)
const audioStyleEdge: WorkflowEdge =
  ({ id: "e", source: "genre", target: "s1", sourceHandle: "out", targetHandle: "audio-style" } as unknown as WorkflowEdge)

function renderSuno(node: WorkflowNode, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  const data = node.data as Record<string, unknown>
  return render(
    <FinalAudioPromptPreview
      consumerNodeId="s1"
      consumerType="suno-generate"
      userPrompt={data.prompt as string | undefined}
      userStyle={data.style as string | undefined}
      customMode={getEffectiveSunoCustomMode(data)}
      nodes={nodes}
      edges={edges}
    />,
  )
}

describe("FinalAudioPromptPreview — suno-generate (Task 3)", () => {
  it("(a) complaint 1+4: typed style + lyrics, empty prompt, NO picker → renders BOTH (was null/empty)", () => {
    const node = sunoNode({ prompt: "", style: "lo-fi", lyrics: "[verse] hi" })
    const { container } = renderSuno(node, [node], [])
    const text = container.textContent ?? ""
    // Today: composition.text is empty (no picker) → component returns null →
    // nothing rendered. After the fix, both typed fields appear.
    expect(text).toContain("lo-fi")
    expect(text).toContain("[verse] hi")
  })

  it("(b) complaint 4: a connected audio-style picker with EMPTY typed fields → non-empty (folded hint shown)", () => {
    const node = sunoNode({ prompt: "", style: "", title: "", lyrics: "" })
    const nodes = [node, genreNode]
    const edges = [audioStyleEdge]
    const hint = collectAudioStyleHints(node, "suno-generate", nodes, edges).text
    expect(hint).not.toBe("")
    const { container } = renderSuno(node, nodes, edges)
    const text = container.textContent ?? ""
    expect(text.length).toBeGreaterThan(0)
    // Non-custom (no typed style/title/lyrics) → the picker folds into the prompt.
    expect(text).toContain(hint)
  })

  it("(c) complaint 1: custom mode (typed title) + connected picker → shows the title AND the folded picker hint", () => {
    // Custom mode auto-engages because `title` is set. The OLD single-field
    // preview showed only "Final style: <hint>" and DROPPED the title.
    const node = sunoNode({ prompt: "", title: "My Song" })
    const nodes = [node, genreNode]
    const edges = [audioStyleEdge]
    const hint = collectAudioStyleHints(node, "suno-generate", nodes, edges).text
    const { container } = renderSuno(node, nodes, edges)
    const text = container.textContent ?? ""
    expect(text).toContain("My Song")
    // The connected picker folds into STYLE in custom mode — still visible now.
    expect(text).toContain(hint)
  })

  it("(d) truly empty (no typed fields, no picker) → renders nothing (null)", () => {
    const node = sunoNode({ prompt: "" })
    const { container } = renderSuno(node, [node], [])
    expect(container.textContent ?? "").toBe("")
  })
})
