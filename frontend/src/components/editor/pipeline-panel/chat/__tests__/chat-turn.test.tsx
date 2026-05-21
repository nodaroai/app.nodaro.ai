import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ChatTurn as ChatTurnType } from "@nodaro/client"
import type { ProposedChange } from "@nodaro/shared"
import { ChatTurnBubble } from "../chat-turn"

function makeTurn(over: Partial<ChatTurnType>): ChatTurnType {
  return {
    id: "t1",
    turn_n: 1,
    role: "user",
    content: "hello",
    proposed_change: null,
    llm_call_id: null,
    applied_to_attempt_id: null,
    created_at: new Date().toISOString(),
    ...over,
  }
}

describe("ChatTurnBubble", () => {
  it("renders a user turn right-aligned", () => {
    render(
      <ChatTurnBubble
        turn={makeTurn({ role: "user", content: "I want a happier ending" })}
        onApplyProposal={vi.fn()}
      />,
    )
    const bubble = screen.getByTestId("chat-turn-1")
    expect(bubble).toHaveAttribute("data-role", "user")
    expect(bubble.className).toContain("justify-end")
    expect(screen.getByText("I want a happier ending")).toBeInTheDocument()
  })

  it("renders an assistant turn left-aligned", () => {
    render(
      <ChatTurnBubble
        turn={makeTurn({ role: "assistant", content: "Sure — here's the plan" })}
        onApplyProposal={vi.fn()}
      />,
    )
    const bubble = screen.getByTestId("chat-turn-1")
    expect(bubble).toHaveAttribute("data-role", "assistant")
    expect(bubble.className).toContain("justify-start")
  })

  it("mounts ProposedChangeCard when assistant + proposed_change present", () => {
    const proposed: ProposedChange = {
      change_type: "edit_artifact",
      json_patch: [{ op: "replace", path: "/title", value: "Hero" }],
      summary: "rename plan title",
    }
    render(
      <ChatTurnBubble
        turn={makeTurn({ role: "assistant", proposed_change: proposed })}
        onApplyProposal={vi.fn()}
      />,
    )
    expect(
      screen.getByTestId("proposed-change-card-edit-artifact"),
    ).toBeInTheDocument()
  })

  it("does NOT mount ProposedChangeCard for user turn even if proposed_change set", () => {
    const proposed: ProposedChange = {
      change_type: "edit_artifact",
      json_patch: [{ op: "replace", path: "/title", value: "x" }],
      summary: "x",
    }
    render(
      <ChatTurnBubble
        turn={makeTurn({ role: "user", proposed_change: proposed })}
        onApplyProposal={vi.fn()}
      />,
    )
    expect(
      screen.queryByTestId("proposed-change-card-edit-artifact"),
    ).not.toBeInTheDocument()
  })

  it("passes applied=true when applied_to_attempt_id is set", () => {
    const proposed: ProposedChange = {
      change_type: "edit_artifact",
      json_patch: [{ op: "replace", path: "/title", value: "x" }],
      summary: "x",
    }
    render(
      <ChatTurnBubble
        turn={makeTurn({
          role: "assistant",
          proposed_change: proposed,
          applied_to_attempt_id: "attempt-1",
        })}
        onApplyProposal={vi.fn()}
      />,
    )
    expect(screen.getByTestId("proposed-change-applied")).toBeInTheDocument()
  })
})
