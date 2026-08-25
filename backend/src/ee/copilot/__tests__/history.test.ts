/**
 * Replay rules. Both exist because the API rejects the alternative outright:
 * a `tool_use` without its `tool_result` in the next message is a 400.
 */
import { describe, expect, it } from "vitest"
import { buildHistory, buildUserContent, extractUserLinks } from "../history.js"
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

describe("vision turns", () => {
  const U1 = "5f0e8f6a-1111-2222-3333-444455556666"
  const U2 = "5f0e8f6a-1111-2222-3333-444455557777"

  it("extractImageRefIds pulls ONLY image-file ids from the trailing glossary", async () => {
    const { extractImageRefIds } = await import("../history.js")
    const message = `make something like this\n\n[references] image file "shot.png" (id: ${U1}); character "Iris" (id: ${U2})`
    expect(extractImageRefIds(message)).toEqual([U1])
  })

  it("ignores ids in prose, malformed ids, and dedupes; caps at the vision limit", async () => {
    const { extractImageRefIds } = await import("../history.js")
    const { TURN_CAPS } = await import("../constants.js")
    expect(extractImageRefIds(`the id ${U1} in prose only`)).toEqual([])
    const many = Array.from({ length: 9 }, (_, i) => `image file "s${i}.png" (id: 5f0e8f6a-1111-2222-3333-44445555000${i})`).join("; ")
    const ids = extractImageRefIds(`x\n\n[references] ${many}; image file "bad" (id: not-a-uuid)`)
    expect(ids).toHaveLength(TURN_CAPS.maxVisionImages)
    const dup = extractImageRefIds(`x\n\n[references] image file "a" (id: ${U1}); image file "b" (id: ${U1})`)
    expect(dup).toEqual([U1])
  })

  it("buildUserContent places image blocks between context and prose — and stays byte-compatible without them", async () => {
    const { buildUserContent } = await import("../history.js")
    expect(buildUserContent("ctx", "hi")).toEqual([
      { type: "text", text: "ctx" },
      { type: "text", text: "hi" },
    ])
    const withImages = buildUserContent("ctx", "hi", ["https://cdn.example/a.png"])
    expect(withImages).toEqual([
      { type: "text", text: "ctx" },
      { type: "image", source: { type: "url", url: "https://cdn.example/a.png" } },
      { type: "text", text: "hi" },
    ])
  })
})

describe("extractUserLinks", () => {
  const row = (role: "user" | "assistant", content: unknown[]): CopilotMessageRow =>
    ({ role, content } as unknown as CopilotMessageRow)

  it("harvests links from user prose — prior user rows and the current message", () => {
    const rows = [
      row("user", [{ type: "text", text: "use https://youtu.be/abc for the vibe" }]),
      row("assistant", [{ type: "text", text: "see https://assistant.example/never" }]),
    ]
    const links = extractUserLinks(rows, "and https://www.youtube.com/watch?v=xyz please")
    expect(links.has("https://youtu.be/abc")).toBe(true)
    expect(links.has("https://www.youtube.com/watch?v=xyz")).toBe(true)
    expect([...links].some((l) => l.includes("assistant.example"))).toBe(false)
  })

  it("strips trailing punctuation from a pasted link", () => {
    expect(extractUserLinks([], "song: https://youtu.be/abc, thanks!").has("https://youtu.be/abc")).toBe(true)
  })

  it("never harvests from tool results, the context preamble, or the glossary", () => {
    // The provenance claim itself: user-role ROWS also carry tool_result
    // blocks and the per-turn context snapshot, and the trailing glossary is
    // machine-appended — none of that is the user's own prose.
    const rows = [
      row("user", [
        { type: "text", text: "<workflow-context-n1>\nnode url https://leak.example/preamble\n</workflow-context-n1>" },
        { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "https://leak.example/tool" }] },
        { type: "text", text: "the real ask" },
      ]),
    ]
    const links = extractUserLinks(rows, 'do it\n\n[references] character "https://leak.example/glossary" (id: x)')
    expect(links.size).toBe(0)
  })

  it("caps the harvest", () => {
    const many = Array.from({ length: 50 }, (_, i) => `https://example.test/${i}`).join(" ")
    expect(extractUserLinks([], many).size).toBe(32)
  })
})
