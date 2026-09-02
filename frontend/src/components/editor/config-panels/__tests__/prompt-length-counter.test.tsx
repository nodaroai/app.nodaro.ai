import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PromptLengthCounter } from "../prompt-length-counter"
import { translate } from "@/lib/i18n"

/** The over-limit copy, resolved through the dict instead of hand-copied. */
const overLimit = (over: number, max: number, noun: string, model?: string) =>
  model !== undefined
    ? translate("en", "cfgext.plcOverLimitModel", { over, model, max, noun })
    : translate("en", "cfgext.plcOverLimit", { over, max, noun })
const DEFAULT_NOUN = translate("en", "audiocfg.prompt")

describe("PromptLengthCounter", () => {
  it("shows the count without a warning when under the limit", () => {
    const { container } = render(<PromptLengthCounter value={"a".repeat(900)} max={1000} modelLabel="kling" />)
    expect(screen.getByText("900/1000")).toBeInTheDocument()
    expect(screen.queryByText(overLimit(100, 1000, DEFAULT_NOUN, "kling"))).not.toBeInTheDocument()
    // No warning block at all — the AlertTriangle only renders when over.
    expect(container.querySelector("svg")).toBeNull()
  })

  it("warns (does not block) when over the per-model limit", () => {
    render(<PromptLengthCounter value={"a".repeat(1200)} max={1000} modelLabel="kling" />)
    expect(screen.getByText("1200/1000")).toBeInTheDocument()
    const warning = screen.getByText(overLimit(200, 1000, DEFAULT_NOUN, "kling")) // 1200 - 1000
    expect(warning).toBeInTheDocument()
    expect(warning.textContent).toContain("200 over")
    expect(warning.textContent).toContain("kling")
  })

  it("uses the field noun in the warning", () => {
    render(<PromptLengthCounter value={"x".repeat(600)} max={500} noun="negative prompt" />)
    expect(screen.getByText(overLimit(100, 500, "negative prompt"))).toBeInTheDocument()
  })

  it("treats empty/undefined as zero", () => {
    render(<PromptLengthCounter value={undefined} max={5000} />)
    expect(screen.getByText("0/5000")).toBeInTheDocument()
  })
})
