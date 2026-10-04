/**
 * The Copilot in the middle of an empty canvas. It never sends a message
 * itself: a message typed here is handed to the rail (`pendingPrompt`), which
 * opens and sends it once its editor callbacks are registered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

const workflowState = { workflowId: "wf-1" as string | null }
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: typeof workflowState) => unknown) => selector(workflowState),
    { getState: () => workflowState },
  ),
}))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "asaf@nodaro.ai", user_metadata: {} } }),
}))
vi.mock("@/ee/hooks/copilot/use-copilot-thread", () => ({
  useCopilotSettings: () => ({ mutate: vi.fn() }),
}))
const platformLinks = vi.fn(() => true)
vi.mock("@/lib/surface-selectors", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-selectors")>()),
  surfacePlatformLinks: () => platformLinks(),
}))

const CopilotCenter = (await import("../copilot-center")).default
const { useCopilotStore } = await import("@/ee/lib/copilot/turn-store")
const { useCopilotUiStore } = await import("@/hooks/use-copilot-ui-store")

const onCreate = vi.fn()
const onContextMenu = vi.fn()

function renderCenter(leaving = false) {
  return render(<CopilotCenter leaving={leaving} onCreate={onCreate} onContextMenu={onContextMenu} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  platformLinks.mockReturnValue(true)
  workflowState.workflowId = "wf-1"
  useCopilotStore.setState({ draft: "", runMode: "ask", modelTier: "standard" })
  useCopilotUiStore.setState({ mode: "center", dock: "min", pendingPrompt: null })
})
afterEach(cleanup)

const promptBox = () => screen.getByPlaceholderText(/Describe the workflow you want/)

describe("asking for a workflow", () => {
  it("greets the person by name", () => {
    renderCenter()
    expect(screen.getByRole("heading", { name: "What should we build, asaf?" })).toBeInTheDocument()
  })

  it("hands what was typed to the rail, opens it and clears the box", () => {
    renderCenter()
    const build = screen.getByRole("button", { name: "Build" })
    fireEvent.click(build)
    expect(useCopilotUiStore.getState().pendingPrompt).toBeNull()
    expect(promptBox()).toHaveFocus()
    fireEvent.change(promptBox(), { target: { value: "  A product ad for my shoes  " } })
    fireEvent.click(build)
    const ui = useCopilotUiStore.getState()
    expect(ui.pendingPrompt).toMatchObject({ text: "A product ad for my shoes", workflowId: "wf-1" })
    expect(ui.mode).toBe("panel")
    expect(useCopilotStore.getState().draft).toBe("")
  })

  it("sends on Enter and keeps a new line on Shift+Enter", () => {
    renderCenter()
    fireEvent.change(promptBox(), { target: { value: "Two lines" } })
    fireEvent.keyDown(promptBox(), { key: "Enter", shiftKey: true })
    expect(useCopilotUiStore.getState().pendingPrompt).toBeNull()
    fireEvent.keyDown(promptBox(), { key: "Enter" })
    expect(useCopilotUiStore.getState().pendingPrompt?.text).toBe("Two lines")
  })

  it("sends a suggestion with one click", () => {
    renderCenter()
    fireEvent.click(screen.getByRole("button", { name: "Turn a script into a narrated video" }))
    expect(useCopilotUiStore.getState().pendingPrompt?.text).toBe("Turn a script into a narrated video")
  })

  it("sends nothing before the workflow exists", () => {
    workflowState.workflowId = null
    renderCenter()
    fireEvent.click(screen.getByRole("button", { name: "Create a product shot workflow" }))
    expect(useCopilotUiStore.getState().pendingPrompt).toBeNull()
  })
})

describe("settings behind one button", () => {
  it("shows the current choice and opens the controls", () => {
    renderCenter()
    const button = screen.getByRole("button", { name: "Copilot settings" })
    expect(button).toHaveTextContent(/Ask\s*·\s*Smart/)
    expect(screen.queryByRole("radiogroup")).toBeNull()
    fireEvent.click(button)
    expect(button).toHaveAttribute("aria-expanded", "true")
    expect(screen.getAllByRole("radiogroup").length).toBeGreaterThan(0)
  })
})

describe("starting by hand", () => {
  it("adds image, video or text, each beside its own coloured square", () => {
    renderCenter()
    const names = ["Image generation", "Video generation", "Text / LLM"]
    const types = ["generate-image", "generate-video", "llm-chat"]
    names.forEach((name, i) => {
      const button = screen.getByRole("button", { name })
      expect(button.querySelector("[class*='rounded-[2px]']"), `${name} has its square`).not.toBeNull()
      fireEvent.click(button)
      expect(onCreate).toHaveBeenLastCalledWith(types[i])
    })
    expect(screen.getByText("Right-click anywhere on the canvas to add a node")).toBeInTheDocument()
  })

  it("passes a right-click through to the canvas menu", () => {
    renderCenter()
    fireEvent.contextMenu(screen.getByRole("heading"))
    expect(onContextMenu).toHaveBeenCalled()
  })
})

describe("Prefer your own AI?", () => {
  it("opens each client's tab of nodaro.ai/mcp in a new browser tab", () => {
    renderCenter()
    for (const [name, slug] of [["Claude Code", "claude-code"], ["Claude", "claude"], ["ChatGPT", "chatgpt"]] as const) {
      const link = screen.getByRole("link", { name })
      expect(link.getAttribute("href")).toMatch(new RegExp(`^https://nodaro\\.ai/mcp\\?.*#client-${slug}$`))
      expect(link).toHaveAttribute("target", "_blank")
      expect(link).toHaveAttribute("rel", "noopener noreferrer")
    }
  })

  it("is gone where the deployment hides platform links", () => {
    platformLinks.mockReturnValue(false)
    renderCenter()
    expect(screen.queryByText("Prefer your own AI?")).toBeNull()
    expect(screen.queryByRole("link", { name: "Claude Code" })).toBeNull()
  })
})

describe("leaving for the rail", () => {
  it("stops taking clicks while it animates out", () => {
    renderCenter(true)
    const card = screen.getByRole("heading").parentElement
    expect(card?.className).toContain("pointer-events-none")
  })
})
