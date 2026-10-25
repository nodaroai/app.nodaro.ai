import { describe, expect, it } from "vitest"
import { current, type ConversationRow } from "../conversation-store.js"

const NOW = new Date("2026-10-25T10:00:00Z")

function row(id: string, createdAt: string, extra: Record<string, unknown> = {}): ConversationRow {
  return {
    id,
    parent_workflow_id: "hub",
    created_at: createdAt,
    settings: {
      mcpConversation: {
        client: "claude-code",
        clientName: "Claude Code",
        key: "k",
        startedAt: createdAt,
        lastActivityAt: createdAt,
        ...extra,
      },
    },
  }
}

const keyed = { client: "claude-code" as const, key: "k" }

describe("current (a keyed chat)", () => {
  it("lands on the row a chat's racing first calls converge on, never a row the race removes", () => {
    // newest first, as `candidates` returns them
    const rows = [row("c2", "2026-10-25T09:00:01Z"), row("c1", "2026-10-25T09:00:00Z")]
    expect(current(rows, keyed, NOW)?.id).toBe("c1")
  })

  it("continues the newest part as it is", () => {
    const rows = [row("p2", "2026-10-25T09:30:00Z", { part: 2, continuedFrom: "c1" }), row("c1", "2026-10-25T09:00:00Z")]
    expect(current(rows, keyed, NOW)?.id).toBe("p2")
  })

  it("a flow started with flow_id \"new\" is the chat's flow from then on, converging only with its own racers", () => {
    const rows = [
      row("n2", "2026-10-25T09:40:05Z", { startedBy: "request" }),
      row("n1", "2026-10-25T09:40:00Z", { startedBy: "request" }),
      row("c1", "2026-10-25T09:39:58Z"),
    ]
    expect(current(rows, keyed, NOW)?.id).toBe("n1")
  })
})
