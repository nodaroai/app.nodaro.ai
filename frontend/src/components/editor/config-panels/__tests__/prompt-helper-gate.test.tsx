import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

/**
 * "Generate with AI" gating (#752): the button renders on CAPABILITY (can
 * this install reach an LLM), never on the billing predicate hasCredits().
 * A Community install with a key or a nodaro.ai connection gets the button;
 * an install with no LLM lane at all does not.
 */

const mockHasCredits = vi.fn(() => false)
const mockUseLlmAvailability = vi.fn(() => true)

vi.mock("@/lib/edition", () => ({
  hasCredits: () => mockHasCredits(),
}))

vi.mock("@/hooks/use-llm-availability", () => ({
  useLlmAvailability: () => mockUseLlmAvailability(),
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      nodes: [],
      edges: [],
      promptEditNodeId: null,
      selectedNodeId: null,
    }),
}))

vi.mock("../prompt-helper-dialog", () => ({
  PromptHelperDialog: () => null,
}))

// SUT imported AFTER the mocks so `vi.mock` takes effect.
import { PromptHelperButton } from "../prompt-helper-button"

beforeEach(() => {
  vi.clearAllMocks()
  mockHasCredits.mockReturnValue(false)
  mockUseLlmAvailability.mockReturnValue(true)
})

describe("PromptHelperButton — capability gate, not billing gate (#752)", () => {
  it("renders on a community install when an LLM lane is available", () => {
    render(
      <PromptHelperButton nodeType="generate-image" currentPrompt="" onAccept={() => {}} />,
    )
    expect(screen.getByRole("button")).toBeInTheDocument()
  })

  it("renders nothing when no LLM lane is reachable", () => {
    mockUseLlmAvailability.mockReturnValue(false)
    const { container } = render(
      <PromptHelperButton nodeType="generate-image" currentPrompt="" onAccept={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("still hides on unsupported node types even with an LLM available", () => {
    const { container } = render(
      <PromptHelperButton nodeType="upload-image" currentPrompt="" onAccept={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
