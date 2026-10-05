import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

import { toast } from "sonner"
import { AiHelperButton } from "../ai-helper-button"

beforeEach(() => {
  vi.clearAllMocks()
})

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

  it("a suggestion that writes its own answer resolves with nothing, and needs no onReplace", async () => {
    // Its answer is written inside the run that paid for it (withRunInFlight).
    let written = ""
    const onSuggest = vi.fn(async () => {
      written = "a tall woman in a grey coat"
    })
    render(<AiHelperButton onSuggest={onSuggest} />)
    const btn = screen.getByRole("button", { name: /suggest/i })
    await userEvent.click(btn)
    await waitFor(() => expect(btn).not.toBeDisabled())
    expect(onSuggest).toHaveBeenCalledTimes(1)
    expect(written).toBe("a tall woman in a grey coat")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("trims the answer, and an empty one replaces nothing", async () => {
    const onReplace = vi.fn()
    const { rerender } = render(<AiHelperButton onSuggest={async () => "  spaced  "} onReplace={onReplace} />)
    await userEvent.click(screen.getByRole("button", { name: /suggest/i }))
    await waitFor(() => expect(onReplace).toHaveBeenCalledWith("spaced"))
    rerender(<AiHelperButton onSuggest={async () => "   "} onReplace={onReplace} />)
    await userEvent.click(screen.getByRole("button", { name: /suggest/i }))
    await waitFor(() => expect(screen.getByRole("button", { name: /suggest/i })).not.toBeDisabled())
    expect(onReplace).toHaveBeenCalledTimes(1)
  })

  it("does NOT call onReplace when onSuggest throws", async () => {
    const onSuggest = vi.fn().mockRejectedValue(new Error("LLM failed"))
    const onReplace = vi.fn()
    render(<AiHelperButton onSuggest={onSuggest} onReplace={onReplace} />)
    await userEvent.click(screen.getByRole("button", { name: /suggest/i }))
    await waitFor(() => expect(onSuggest).toHaveBeenCalled())
    expect(onReplace).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("LLM failed")
  })
})
