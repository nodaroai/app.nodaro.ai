import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ChatTurn as ChatTurnType } from "@nodaro/client"
import { ChatHistory } from "../chat-history"

function makeTurn(over: Partial<ChatTurnType>): ChatTurnType {
  return {
    id: "t" + (over.turn_n ?? 1),
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

describe("ChatHistory", () => {
  beforeEach(() => {
    // jsdom doesn't ship scrollIntoView; install a spy so the auto-scroll
    // effect doesn't throw.
    Element.prototype.scrollIntoView = vi.fn()
  })

  it("renders empty-state when there are no turns", () => {
    render(<ChatHistory turns={[]} onApplyProposal={vi.fn()} />)
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument()
  })

  it("renders one bubble per turn", () => {
    render(
      <ChatHistory
        turns={[
          makeTurn({ id: "1", turn_n: 1, role: "user", content: "hi" }),
          makeTurn({ id: "2", turn_n: 2, role: "assistant", content: "hello" }),
        ]}
        onApplyProposal={vi.fn()}
      />,
    )
    expect(screen.getByTestId("chat-turn-1")).toBeInTheDocument()
    expect(screen.getByTestId("chat-turn-2")).toBeInTheDocument()
  })

  it("sorts turns by turn_n ascending", () => {
    render(
      <ChatHistory
        turns={[
          makeTurn({ id: "b", turn_n: 2, content: "second" }),
          makeTurn({ id: "a", turn_n: 1, content: "first" }),
        ]}
        onApplyProposal={vi.fn()}
      />,
    )
    const history = screen.getByTestId("chat-history")
    const turnEls = history.querySelectorAll('[data-testid^="chat-turn-"]')
    expect(turnEls[0]).toHaveAttribute("data-testid", "chat-turn-1")
    expect(turnEls[1]).toHaveAttribute("data-testid", "chat-turn-2")
  })

  it("auto-scrolls to the end on new turn", () => {
    const spy = vi.spyOn(Element.prototype, "scrollIntoView")
    const { rerender } = render(
      <ChatHistory
        turns={[makeTurn({ id: "1", turn_n: 1 })]}
        onApplyProposal={vi.fn()}
      />,
    )
    rerender(
      <ChatHistory
        turns={[
          makeTurn({ id: "1", turn_n: 1 }),
          makeTurn({ id: "2", turn_n: 2 }),
        ]}
        onApplyProposal={vi.fn()}
      />,
    )
    expect(spy).toHaveBeenCalled()
  })
})
