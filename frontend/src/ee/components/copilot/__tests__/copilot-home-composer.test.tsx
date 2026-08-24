/**
 * The home dock.
 *
 * Three things here are not obvious enough to leave unpinned: that × collapses
 * to a pill that can bring it BACK (the previous version dismissed it forever),
 * that a mention leaves as part of the one string the hop carries rather than
 * as UI state that dies at the navigation, and that the length cap is applied
 * to that string and not just to what was typed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const navigate = vi.fn()
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom")
  return { ...actual, useNavigate: () => navigate }
})
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "asi@nodaro.ai", user_metadata: {} } }),
}))

const CHARACTERS = { data: [{ id: "c1", name: "Maya", sourceImageUrl: null }], isLoading: false }
const LOCATIONS = { data: [] as unknown[], isLoading: false }
const useCharacters = vi.fn((_projectId?: string, _userId?: string) => CHARACTERS)
const useLocations = vi.fn((_projectId?: string, _userId?: string) => LOCATIONS)
vi.mock("@/hooks/queries/use-assets-queries", () => ({
  useCharacters: (projectId?: string, userId?: string) => useCharacters(projectId, userId),
  useLocations: (projectId?: string, userId?: string) => useLocations(projectId, userId),
}))

const createCopilotThread = vi.fn(async (_body: { prompt: string }) => ({
  thread: { id: "th-1" },
  workflow: { id: "wf-1", projectId: "p1" },
}))
vi.mock("@/ee/lib/copilot/api", async () => {
  const actual = await vi.importActual<typeof import("@/ee/lib/copilot/api")>("@/ee/lib/copilot/api")
  return { ...actual, createCopilotThread: (body: { prompt: string }) => createCopilotThread(body) }
})

const CopilotHomeComposer = (await import("../copilot-home-composer")).default
const { COPILOT_MESSAGE_MAX_CHARS } = await import("@/ee/lib/copilot/constants")

const DOCK_KEY = "nodaro.copilot.home.dismissed"

function renderDock() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CopilotHomeComposer />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const input = () => screen.getByRole("combobox") as HTMLInputElement

beforeEach(() => {
  vi.clearAllMocks()
  // `clearAllMocks` clears calls, not implementations — a test that swaps the
  // list state would otherwise leak into every test after it.
  useCharacters.mockReturnValue(CHARACTERS)
  useLocations.mockReturnValue(LOCATIONS)
  window.localStorage.clear()
})

describe("home dock", () => {
  it("collapses to a pill that opens it again", () => {
    renderDock()
    expect(input()).toBeTruthy()

    fireEvent.click(screen.getByLabelText("Collapse Copilot"))
    expect(screen.queryByRole("combobox")).toBeNull()
    // The point of the change: there is still a way back.
    const pill = screen.getByLabelText("Open Copilot")
    expect(window.localStorage.getItem(DOCK_KEY)).toBe("1")

    fireEvent.click(pill)
    expect(input()).toBeTruthy()
    expect(window.localStorage.getItem(DOCK_KEY)).toBe("0")
  })

  it("starts collapsed for a user who dismissed the old version", () => {
    window.localStorage.setItem(DOCK_KEY, "1")
    renderDock()
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(screen.getByLabelText("Open Copilot")).toBeTruthy()
  })

  it("does not fetch the mention lists while collapsed", () => {
    window.localStorage.setItem(DOCK_KEY, "1")
    renderDock()
    // `enabled: !!userId` is what gates the query, so a missing user id is the
    // signal — a pill must not cost two list requests per home visit.
    expect(useCharacters).toHaveBeenCalledWith(undefined, undefined)
    expect(useLocations).toHaveBeenCalledWith(undefined, undefined)
  })

  it("asks for every project's entities, not one project's", () => {
    renderDock()
    expect(useCharacters).toHaveBeenCalledWith(undefined, "u1")
  })

  it("toggles on the Copilot shortcut", () => {
    renderDock()
    fireEvent.keyDown(window, { key: "j", code: "KeyJ", ctrlKey: true })
    expect(screen.queryByRole("combobox")).toBeNull()
    fireEvent.keyDown(window, { key: "j", code: "KeyJ", ctrlKey: true })
    expect(input()).toBeTruthy()
  })

  it("leaves the picked name in the sentence rather than lifting it out", async () => {
    // The whole point of a mention's POSITION: "@Emma walks in while @George
    // raises the bottle" says who does what; two chips above the box do not.
    renderDock()
    fireEvent.change(input(), { target: { value: "a shot of " } })
    fireEvent.click(screen.getByLabelText("Mention something of yours"))
    fireEvent.click(await screen.findByRole("option", { name: /Maya/ }))
    // Trailing space: the user is mid-sentence and keeps typing.
    expect(input().value).toBe("a shot of @Maya ")
  })

  it("sends a mention as part of the prompt the hop carries", async () => {
    renderDock()
    fireEvent.change(input(), { target: { value: "a shot of " } })
    fireEvent.click(screen.getByLabelText("Mention something of yours"))
    fireEvent.click(await screen.findByRole("option", { name: /Maya/ }))

    fireEvent.change(input(), { target: { value: "a shot of her" } })
    fireEvent.click(screen.getByRole("button", { name: /Build it/ }))

    await waitFor(() => expect(createCopilotThread).toHaveBeenCalled())
    const prompt = createCopilotThread.mock.calls[0]?.[0].prompt ?? ""
    // The id is what makes the mention resolvable on the other side; a URL
    // would be refused by `edit_workflow` and is deliberately absent.
    expect(prompt).toContain("a shot of her")
    expect(prompt).toContain('[references] character "Maya" (id: c1)')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/projects/p1/workflows/wf-1?copilot=th-1"))
  })

  it("refuses a wire message the server would reject, instead of spending the click", async () => {
    renderDock()
    fireEvent.click(screen.getByLabelText("Mention something of yours"))
    fireEvent.click(await screen.findByRole("option", { name: /Maya/ }))

    // maxLength bounds typing; a paste that predates the mention does not go
    // through it, which is exactly the case that used to 400 after the click.
    fireEvent.change(input(), { target: { value: "x".repeat(COPILOT_MESSAGE_MAX_CHARS) } })
    fireEvent.click(screen.getByRole("button", { name: /Build it/ }))

    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(createCopilotThread).not.toHaveBeenCalled()
  })

  it("says it is looking rather than that there is nothing, while the lists load", async () => {
    // The state after expanding a collapsed dock: the fetch has started and
    // has not resolved. Telling a user with fifty characters they have none is
    // worse than saying nothing.
    useCharacters.mockReturnValue({ data: [], isLoading: true } as never)
    useLocations.mockReturnValue({ data: [], isLoading: true } as never)
    renderDock()
    fireEvent.click(screen.getByLabelText("Mention something of yours"))
    expect(await screen.findByText("Looking…")).toBeTruthy()
    expect(screen.queryByText("Nothing here yet")).toBeNull()
  })

  it("still says there is nothing when there genuinely is not", async () => {
    useCharacters.mockReturnValue({ data: [], isLoading: false } as never)
    useLocations.mockReturnValue({ data: [], isLoading: false } as never)
    renderDock()
    fireEvent.click(screen.getByLabelText("Mention something of yours"))
    expect(await screen.findByText("Nothing here yet")).toBeTruthy()
  })

  it("clears the length error once the user acts on it", async () => {
    renderDock()
    fireEvent.click(screen.getByLabelText("Mention something of yours"))
    fireEvent.click(await screen.findByRole("option", { name: /Maya/ }))
    fireEvent.change(input(), { target: { value: "x".repeat(COPILOT_MESSAGE_MAX_CHARS) } })
    fireEvent.click(screen.getByRole("button", { name: /Build it/ }))
    expect(await screen.findByRole("alert")).toBeTruthy()

    // The error's own advice: "shorten it, or remove a mention."
    fireEvent.click(screen.getByLabelText("Remove Maya"))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("leaves room for the references line in the input's own cap", async () => {
    renderDock()
    expect(input().maxLength).toBe(COPILOT_MESSAGE_MAX_CHARS)
    fireEvent.click(screen.getByLabelText("Mention something of yours"))
    fireEvent.click(await screen.findByRole("option", { name: /Maya/ }))
    expect(input().maxLength).toBeLessThan(COPILOT_MESSAGE_MAX_CHARS)
  })

  it("drops a mention without touching the typed text", async () => {
    renderDock()
    fireEvent.change(input(), { target: { value: "hello" } })
    fireEvent.click(screen.getByLabelText("Mention something of yours"))
    fireEvent.click(await screen.findByRole("option", { name: /Maya/ }))

    fireEvent.change(input(), { target: { value: "hello" } })
    fireEvent.click(screen.getByLabelText("Remove Maya"))
    fireEvent.click(screen.getByRole("button", { name: /Build it/ }))

    await waitFor(() => expect(createCopilotThread).toHaveBeenCalledWith({ prompt: "hello" }))
  })
})
