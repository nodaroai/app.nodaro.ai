import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ChatInput } from "../chat-input"

describe("ChatInput", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders the remaining-turn count when not at cap", () => {
    render(<ChatInput onSend={vi.fn()} remaining={5} />)
    expect(screen.getByTestId("chat-input-remaining")).toHaveTextContent(
      "5 turns remaining",
    )
  })

  it("uses singular 'turn' when remaining=1", () => {
    render(<ChatInput onSend={vi.fn()} remaining={1} />)
    expect(screen.getByTestId("chat-input-remaining")).toHaveTextContent(
      "1 turn remaining",
    )
  })

  it("disables textarea + button + shows cap message when isAtCap", () => {
    render(<ChatInput onSend={vi.fn()} remaining={0} isAtCap />)
    expect(
      (screen.getByTestId("chat-input-textarea") as HTMLTextAreaElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByTestId("chat-input-send-btn") as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByTestId("chat-input-cap-reached")).toHaveTextContent(
      "Chat limit reached. Approve, branch, or switch to Manual Mode.",
    )
  })

  it("Enter sends the trimmed draft + clears the textarea", async () => {
    const onSend = vi.fn()
    render(<ChatInput onSend={onSend} remaining={10} />)
    const ta = screen.getByTestId("chat-input-textarea") as HTMLTextAreaElement
    await userEvent.type(ta, "  hello world  ")
    await userEvent.keyboard("{Enter}")
    expect(onSend).toHaveBeenCalledWith("hello world")
    expect(ta.value).toBe("")
  })

  it("Shift+Enter inserts a newline, does not send", async () => {
    const onSend = vi.fn()
    render(<ChatInput onSend={onSend} remaining={10} />)
    const ta = screen.getByTestId("chat-input-textarea") as HTMLTextAreaElement
    await userEvent.type(ta, "line1")
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}")
    await userEvent.type(ta, "line2")
    expect(ta.value).toBe("line1\nline2")
    expect(onSend).not.toHaveBeenCalled()
  })

  it("disables send when draft is empty/whitespace-only", async () => {
    render(<ChatInput onSend={vi.fn()} remaining={10} />)
    expect(
      (screen.getByTestId("chat-input-send-btn") as HTMLButtonElement).disabled,
    ).toBe(true)
    await userEvent.type(screen.getByTestId("chat-input-textarea"), "    ")
    expect(
      (screen.getByTestId("chat-input-send-btn") as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it("send button click sends when canSend", async () => {
    const onSend = vi.fn()
    render(<ChatInput onSend={onSend} remaining={10} />)
    await userEvent.type(screen.getByTestId("chat-input-textarea"), "hi")
    await userEvent.click(screen.getByTestId("chat-input-send-btn"))
    expect(onSend).toHaveBeenCalledWith("hi")
  })

  it("disables send + shows 'Sending…' while isSending", () => {
    render(<ChatInput onSend={vi.fn()} remaining={10} isSending />)
    const btn = screen.getByTestId("chat-input-send-btn") as HTMLButtonElement
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent("Sending…")
  })
})
