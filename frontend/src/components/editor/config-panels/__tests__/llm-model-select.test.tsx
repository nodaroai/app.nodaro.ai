import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LlmModelSelect } from "../llm-model-select"
import { STRUCTURED_VISION_MODELS, LLM_FEATURE_DEFAULTS, getLlmModel } from "@nodaro/shared"

// The hint fetches credits behind hasCredits(); stub it so renders are pure.
vi.mock("../model-description-hint", () => ({ ModelDescriptionHint: () => null }))

describe("LlmModelSelect (grouped searchable combobox)", () => {
  it("shows the selected model's display name and tier on the trigger", () => {
    render(<LlmModelSelect feature="llm-chat" value="grok-4.6" onChange={() => {}} />)
    const trigger = screen.getByRole("combobox", { name: "AI Model" })
    expect(trigger).toHaveTextContent("Grok 4.6")
    expect(trigger).toHaveTextContent("Standard")
  })

  it("falls back to the feature default when no value is set", () => {
    render(<LlmModelSelect feature="llm-chat" onChange={() => {}} />)
    const def = getLlmModel(LLM_FEATURE_DEFAULTS["llm-chat"])!
    expect(screen.getByRole("combobox", { name: "AI Model" })).toHaveTextContent(def.displayName)
  })

  it("opens to vendor group headings in the shared order and selects a model", () => {
    const onChange = vi.fn()
    render(<LlmModelSelect feature="llm-chat" onChange={onChange} />)
    fireEvent.click(screen.getByRole("combobox", { name: "AI Model" }))
    // All four vendor groups render as headings, in the shared fixed order.
    const headings = ["Anthropic", "Google", "OpenAI", "xAI"].map((label) => screen.getByText(label))
    expect(headings).toHaveLength(4)
    fireEvent.click(screen.getByText("Grok 4.6"))
    expect(onChange).toHaveBeenCalledWith("grok-4.6")
  })

  it("search narrows by vendor label and clears on close", () => {
    render(<LlmModelSelect feature="llm-chat" onChange={() => {}} />)
    fireEvent.click(screen.getByRole("combobox", { name: "AI Model" }))
    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: "xai" } })
    expect(screen.getByText("Grok 4.6")).toBeInTheDocument()
    expect(screen.queryByText("Gemini 3 Flash")).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: "no-such-model-zzz" } })
    expect(screen.getByText("No models match.")).toBeInTheDocument()
  })

  it("honors the filter predicate (describe-to-picker's structured-vision restriction)", () => {
    const allowed = new Set(STRUCTURED_VISION_MODELS.map((m) => m.id))
    render(
      <LlmModelSelect
        feature="describe-to-picker"
        onChange={() => {}}
        filter={(m) => allowed.has(m.id)}
      />,
    )
    fireEvent.click(screen.getByRole("combobox", { name: "AI Model" }))
    // gpt-5.2 is the one vision model with no structured mode — must be hidden.
    expect(screen.queryByText("GPT-5.2")).not.toBeInTheDocument()
    expect(screen.getByText("Grok 4.6")).toBeInTheDocument()
  })
})
