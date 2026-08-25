/**
 * The gap miner must aggregate SHAPES, not strings: two users hitting the same
 * wall with different ids/names/numbers is ONE gap with two hits — otherwise
 * the ranked list is a phone book and teaches nothing.
 */
import { describe, expect, it } from "vitest"
import { collectGaps, normalizeGapKey, renderGapReport, stripUntrustedFence } from "../knowledge-gaps.js"

const fence = (tool: string, inner: string, nonce = "deadbeefcafe") =>
  `<untrusted-${nonce} tool="${tool}">\n${inner}\n</untrusted-${nonce}>`

function toolResultRow(threadId: string, text: string, isError: boolean) {
  return {
    thread_id: threadId,
    content: [{ type: "tool_result", tool_use_id: "tu1", content: text, is_error: isError || undefined }],
  }
}

describe("stripUntrustedFence", () => {
  it("recovers the tool name and the inner text", () => {
    const { toolName, inner } = stripUntrustedFence(fence("edit_workflow", "Node id \"X\" is not allowed."))
    expect(toolName).toBe("edit_workflow")
    expect(inner).toBe('Node id "X" is not allowed.')
  })

  it("passes unfenced text through (older rows, native formats)", () => {
    const { toolName, inner } = stripUntrustedFence("plain text")
    expect(toolName).toBeNull()
    expect(inner).toBe("plain text")
  })
})

describe("normalizeGapKey", () => {
  it("collapses ids, quoted names and numbers so same-shape failures share a bucket", () => {
    const a = normalizeGapKey('Node id "hero-shot" is not allowed. Use lowercase (max 64 chars).')
    const b = normalizeGapKey('Node id "SCENE ONE" is not allowed. Use lowercase (max 12 chars).')
    expect(a).toBe(b)
    expect(a).toContain('"<name>"')
    expect(a).toContain("<n>")
    expect(normalizeGapKey("asset 5f0e8f6a-1111-2222-3333-444455556666 not found")).toContain("<id>")
  })
})

describe("collectGaps", () => {
  it("buckets error tool_results by tool + shape, counting threads", () => {
    const rows = [
      toolResultRow("t1", fence("edit_workflow", 'Node id "a b" is not allowed. Max 64.'), true),
      toolResultRow("t2", fence("edit_workflow", 'Node id "c d" is not allowed. Max 64.'), true),
      toolResultRow("t2", fence("get_character", "Character not found."), true),
    ]
    const { rejections } = collectGaps(rows)
    expect(rejections[0]!.count).toBe(2)
    expect(rejections[0]!.threads).toHaveLength(2)
    expect(rejections[0]!.key).toContain("edit_workflow")
    expect(rejections).toHaveLength(2)
  })

  it("mines adjustments and warnings out of SUCCESSFUL edit_workflow results", () => {
    const payload = JSON.stringify({
      version: 9,
      adjustments: ['Moved node "hero-shot" onto the grid', 'Moved node "villain-shot" onto the grid'],
      warnings: ["Edge 12 targets a missing handle"],
    })
    const rows = [toolResultRow("t1", fence("edit_workflow", payload), false)]
    const { adjustments } = collectGaps(rows)
    expect(adjustments[0]!.count).toBe(2)
    expect(adjustments).toHaveLength(2)
  })

  it("ignores non-tool blocks and malformed content without throwing", () => {
    const rows = [
      { thread_id: "t1", content: [{ type: "text", text: "hello" }] },
      { thread_id: "t2", content: "not an array" },
      toolResultRow("t3", fence("edit_workflow", "{truncated"), false),
    ]
    const { rejections, adjustments } = collectGaps(rows)
    expect(rejections).toHaveLength(0)
    expect(adjustments).toHaveLength(0)
  })
})

describe("renderGapReport", () => {
  it("ranks buckets and never renders an empty section silently", () => {
    const report = renderGapReport({
      windowDays: 7,
      scannedMessages: 12,
      rejections: [
        { key: "edit_workflow: bad id", count: 3, threads: ["a", "b"], sample: "bad id sample" },
        { key: "get_character: missing", count: 1, threads: ["a"], sample: "missing" },
      ],
      adjustments: [],
      turnFailures: [{ title: "Copilot turn failed", count: 2 }],
      contextCounts: [{ kind: "validation-reject", count: 4 }],
    })
    expect(report.indexOf("edit_workflow: bad id")).toBeLessThan(report.indexOf("get_character: missing"))
    expect(report).toContain("**3×** (2 threads)")
    expect(report).toContain("every edit landed as sent")
    expect(report).toContain("validation-reject: 4")
  })
})
