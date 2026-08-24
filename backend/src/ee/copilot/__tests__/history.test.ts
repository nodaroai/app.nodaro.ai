/**
 * Replay rules. Both exist because the API rejects the alternative outright:
 * a `tool_use` without its `tool_result` in the next message is a 400.
 */
import { describe, expect, it } from "vitest"
import { buildHistory, buildUserContent } from "../history.js"
import type { CopilotMessageRow } from "../store.js"

let seq = 0
function row(turnId: string, role: "user" | "assistant", content: unknown[]): CopilotMessageRow {
  seq += 1
  return {
    id: `m${seq}`,
    thread_id: "t1",
    turn_id: turnId,
    seq,
    role,
    content,
    context_preamble: null,
    text_preview: null,
    created_at: "2026-08-23T10:00:00Z",
  }
}

describe("buildHistory", () => {
  it("replays complete turns in order", () => {
    const rows = [
      row("turn1", "user", [{ type: "text", text: "hello" }]),
      row("turn1", "assistant", [{ type: "text", text: "hi" }]),
      row("turn2", "user", [{ type: "text", text: "again" }]),
      row("turn2", "assistant", [{ type: "text", text: "sure" }]),
    ]
    const history = buildHistory(rows)
    expect(history).toHaveLength(4)
    expect(history[0]!.role).toBe("user")
    expect(history[3]!.role).toBe("assistant")
  })

  it("drops a crashed turn whose tool_use was never answered", () => {
    const rows = [
      row("turn1", "user", [{ type: "text", text: "ok" }]),
      row("turn1", "assistant", [{ type: "text", text: "done" }]),
      row("turn2", "user", [{ type: "text", text: "build it" }]),
      row("turn2", "assistant", [{ type: "tool_use", id: "t1", name: "get_graph", input: {} }]),
    ]
    const history = buildHistory(rows)
    expect(history).toHaveLength(2)
    expect(JSON.stringify(history)).not.toContain("tool_use")
  })

  it("truncates by WHOLE turns, keeping the newest", () => {
    // Over the ~480k-char history budget (120k tokens × 4) in ONE turn, so
    // the older turn cannot fit and is dropped whole.
    const big = "x".repeat(300_000)
    const rows = [
      row("old", "user", [{ type: "text", text: big }]),
      row("old", "assistant", [{ type: "text", text: big }]),
      row("recent", "user", [{ type: "text", text: "small" }]),
      row("recent", "assistant", [{ type: "text", text: "reply" }]),
    ]
    const history = buildHistory(rows)
    expect(history).toHaveLength(2)
    expect(JSON.stringify(history)).toContain("small")
    expect(JSON.stringify(history)).not.toContain(big)
  })

  it("drops a replayed preamble whether it carries a nonce or not", () => {
    // The fence gained a per-turn nonce, but every row written before that is
    // still in the database with the bare tag. Both must strip, or an old
    // thread replays ten contradictory node inventories — which is the exact
    // failure this strip exists to prevent.
    const rows = [
      row("turn1", "user", [
        { type: "text", text: "<workflow-context>OLD SNAPSHOT</workflow-context>" },
        { type: "text", text: "first question" },
      ]),
      row("turn1", "assistant", [{ type: "text", text: "done" }]),
      row("turn2", "user", [
        { type: "text", text: "<workflow-context-a1b2c3>NEW SNAPSHOT</workflow-context-a1b2c3>" },
        { type: "text", text: "second question" },
      ]),
      row("turn2", "assistant", [{ type: "text", text: "done" }]),
    ]

    const replayed = JSON.stringify(buildHistory(rows))

    expect(replayed).not.toContain("OLD SNAPSHOT")
    expect(replayed).not.toContain("NEW SNAPSHOT")
    expect(replayed).toContain("first question")
    expect(replayed).toContain("second question")
  })

  it("skips rows with no content instead of sending an empty message", () => {
    expect(buildHistory([row("turn1", "user", [])])).toEqual([])
  })
})

describe("buildUserContent", () => {
  it("puts the volatile context first and the user's words second", () => {
    const content = buildUserContent("<workflow-context>ctx</workflow-context>", "make a video")
    expect(content).toHaveLength(2)
    expect((content[0] as { text: string }).text).toContain("workflow-context")
    expect((content[1] as { text: string }).text).toBe("make a video")
  })
})
