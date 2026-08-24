/**
 * What leaves the server for the panel. Thinking blocks and raw tool results
 * (prompts, media URLs, provider error strings) must never reach a browser.
 */
import { describe, expect, it } from "vitest"
import { toDisplayMessages } from "../display.js"
import type { CopilotMessageRow } from "../store.js"

function row(partial: Partial<CopilotMessageRow>): CopilotMessageRow {
  return {
    id: "m1",
    thread_id: "t1",
    turn_id: "turn1",
    seq: 1,
    role: "assistant",
    content: [],
    context_preamble: null,
    text_preview: null,
    created_at: "2026-08-23T10:00:00Z",
    ...partial,
  }
}

describe("toDisplayMessages", () => {
  it("keeps prose and turns tool_use into a labelled activity row", () => {
    const messages = toDisplayMessages([
      row({
        content: [
          { type: "thinking", thinking: "secret reasoning" },
          { type: "text", text: "Adding an image node." },
          { type: "tool_use", id: "t1", name: "edit_workflow", input: { note: "x" } },
        ],
      }),
    ])
    expect(messages[0]!.parts).toEqual([
      { kind: "text", text: "Adding an image node." },
      { kind: "tool_call", id: "t1", name: "edit_workflow", label: "Editing the canvas", status: "finished" },
    ])
  })

  it("never emits thinking or tool_result content", () => {
    const json = JSON.stringify(
      toDisplayMessages([
        row({ content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "ok" }] }),
        row({
          id: "m2",
          seq: 2,
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "<untrusted-x>raw provider error</untrusted-x>" }],
        }),
      ]),
    )
    expect(json).not.toContain("hidden")
    expect(json).not.toContain("raw provider error")
  })

  it("marks a failed tool call from its result", () => {
    const messages = toDisplayMessages([
      row({ content: [{ type: "tool_use", id: "t1", name: "get_graph", input: {} }] }),
      row({ id: "m2", seq: 2, role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "boom" }] }),
    ])
    expect(messages[0]!.parts[0]).toMatchObject({ kind: "tool_call", status: "failed" })
  })

  it("hides the generated workflow-context preamble from the user's message", () => {
    const messages = toDisplayMessages([
      row({
        role: "user",
        content: [
          { type: "text", text: "<workflow-context>\nnodes…\n</workflow-context>" },
          { type: "text", text: "make me a product shot" },
        ],
      }),
    ])
    expect(messages[0]!.parts).toEqual([{ kind: "text", text: "make me a product shot" }])
  })

  it("hides it when the fence carries a nonce too", () => {
    // The fence gained a per-turn nonce; rows written before that still have
    // the bare tag, and BOTH are in the database. Miss the nonced form and the
    // node inventory renders in the panel as if the user had typed it.
    const messages = toDisplayMessages([
      row({
        role: "user",
        content: [
          { type: "text", text: "<workflow-context-a1b2c3>\nnodes…\n</workflow-context-a1b2c3>" },
          { type: "text", text: "make me a product shot" },
        ],
      }),
    ])
    expect(messages[0]!.parts).toEqual([{ kind: "text", text: "make me a product shot" }])
  })

  it("still shows a message that merely MENTIONS the fence", () => {
    // The strip matches a block that STARTS with the fence, on any text block
    // of a user row — not only the first. So a user asking ABOUT the tag keeps
    // their message; one whose text opened with it would lose it, which is
    // pre-existing, needs the exact opening string, and is not worth machinery.
    const messages = toDisplayMessages([
      row({
        role: "user",
        content: [{ type: "text", text: "why does my prompt contain <workflow-context> ?" }],
      }),
    ])
    expect(messages[0]!.parts).toHaveLength(1)
  })
})
