import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PromptInjectionPreview } from "../prompt-injection-preview"

describe("PromptInjectionPreview", () => {
  it("renders a single string hint", () => {
    render(<PromptInjectionPreview hints="cinematic, film grain" />)
    expect(screen.getByText("cinematic, film grain")).toBeDefined()
  })

  it("renders an array of strings joined by ', '", () => {
    render(<PromptInjectionPreview hints={["soft lighting", "warm tones"]} />)
    expect(screen.getByText("soft lighting, warm tones")).toBeDefined()
  })

  it("flattens nested string arrays (the spread-string-bug guard)", () => {
    // This is the shape the new API accepts to AVOID the spread footgun:
    // `[preText, build*Hints(), postText]` where build*Hints returns
    // string[]. Without the in-component flatten, callers would have had
    // to spread the inner array — and accidentally spreading a string
    // hint instead would render one char per row (the CameraMotion
    // regression that motivated this signature).
    render(
      <PromptInjectionPreview
        hints={["before:", ["soft lighting", "warm tones"], "after"]}
      />,
    )
    expect(
      screen.getByText("before:, soft lighting, warm tones, after"),
    ).toBeDefined()
  })

  it("drops falsy entries (empty strings, null, undefined, false)", () => {
    render(
      <PromptInjectionPreview
        hints={["", "kept-1", null, undefined, false, "kept-2"]}
      />,
    )
    expect(screen.getByText("kept-1, kept-2")).toBeDefined()
  })

  it("drops empty strings from nested arrays", () => {
    render(
      <PromptInjectionPreview
        hints={["outer", ["", "inner", ""], "tail"]}
      />,
    )
    expect(screen.getByText("outer, inner, tail")).toBeDefined()
  })

  it("renders placeholder when nothing to inject", () => {
    render(<PromptInjectionPreview hints={[null, undefined, "", false]} />)
    expect(
      screen.getByText(/nothing selected/),
    ).toBeDefined()
  })

  it("renders placeholder for empty string input", () => {
    render(<PromptInjectionPreview hints="" />)
    expect(
      screen.getByText(/nothing selected/),
    ).toBeDefined()
  })

  it("does NOT spread-explode a string passed as a single array element", () => {
    // Regression guard: passing a string into the array (rather than
    // spreading it) must render as the whole string, not per-character.
    render(<PromptInjectionPreview hints={["locked off static camera"]} />)
    expect(screen.getByText("locked off static camera")).toBeDefined()
    // No "l, o, c, k, e, d" anywhere
    expect(screen.queryByText(/^l, o, c/)).toBeNull()
  })
})
