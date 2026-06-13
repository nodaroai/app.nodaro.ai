import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PromptLengthCounter } from "../prompt-length-counter"

describe("PromptLengthCounter", () => {
  it("shows the count without a warning when under the limit", () => {
    render(<PromptLengthCounter value={"a".repeat(900)} max={1000} modelLabel="kling" />)
    expect(screen.getByText("900/1000")).toBeInTheDocument()
    expect(screen.queryByText(/will be truncated/i)).not.toBeInTheDocument()
  })

  it("warns (does not block) when over the per-model limit", () => {
    render(<PromptLengthCounter value={"a".repeat(1200)} max={1000} modelLabel="kling" />)
    expect(screen.getByText("1200/1000")).toBeInTheDocument()
    const warning = screen.getByText(/will be truncated/i)
    expect(warning).toBeInTheDocument()
    expect(warning.textContent).toContain("200 over") // 1200 - 1000
    expect(warning.textContent).toContain("kling")
  })

  it("uses the field noun in the warning", () => {
    render(<PromptLengthCounter value={"x".repeat(600)} max={500} noun="negative prompt" />)
    expect(screen.getByText(/negative prompt/i)).toBeInTheDocument()
  })

  it("treats empty/undefined as zero", () => {
    render(<PromptLengthCounter value={undefined} max={5000} />)
    expect(screen.getByText("0/5000")).toBeInTheDocument()
  })
})
