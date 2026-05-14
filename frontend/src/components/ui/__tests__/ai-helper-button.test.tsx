import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AiHelperButton } from "../ai-helper-button"

describe("AiHelperButton", () => {
  it("renders the sparkle icon with default title", () => {
    render(<AiHelperButton onSuggest={async () => "x"} onReplace={() => {}} />)
    expect(screen.getByRole("button", { name: /suggest/i })).toBeInTheDocument()
  })

  it("calls onSuggest and onReplace with the returned text on click", async () => {
    const onSuggest = vi.fn().mockResolvedValue("a stoic warrior with a scar")
    const onReplace = vi.fn()
    render(<AiHelperButton onSuggest={onSuggest} onReplace={onReplace} />)
    await userEvent.click(screen.getByRole("button", { name: /suggest/i }))
    await waitFor(() =>
      expect(onReplace).toHaveBeenCalledWith("a stoic warrior with a scar"),
    )
    expect(onSuggest).toHaveBeenCalledTimes(1)
  })

  it("disables the button while in-flight to prevent double-click", async () => {
    let resolve: (v: string) => void = () => {}
    const onSuggest = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r
        }),
    )
    const onReplace = vi.fn()
    render(<AiHelperButton onSuggest={onSuggest} onReplace={onReplace} />)
    const btn = screen.getByRole("button", { name: /suggest/i })
    await userEvent.click(btn)
    expect(btn).toBeDisabled()
    resolve("result")
    await waitFor(() => expect(btn).not.toBeDisabled())
  })

  it("does NOT call onReplace when onSuggest throws", async () => {
    const onSuggest = vi.fn().mockRejectedValue(new Error("LLM failed"))
    const onReplace = vi.fn()
    render(<AiHelperButton onSuggest={onSuggest} onReplace={onReplace} />)
    await userEvent.click(screen.getByRole("button", { name: /suggest/i }))
    await waitFor(() => expect(onSuggest).toHaveBeenCalled())
    expect(onReplace).not.toHaveBeenCalled()
  })
})
