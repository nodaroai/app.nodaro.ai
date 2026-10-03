/**
 * The inspiration wall: the saves, newest first, with the person's notes and
 * tags; the copied still rather than the platform's expiring link; filters;
 * note / tag edits; a remove that asks first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { SavedPost } from "@nodaro/shared"
import { en } from "@/lib/i18n/en"
import { parseTagInput, savedPostStill } from "@/components/research/saved-post-card"

const api = vi.hoisted(() => ({
  listSavedPosts: vi.fn(),
  updateSavedPost: vi.fn(),
  deleteSavedPost: vi.fn(),
}))

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import InspirationPage from "../page"

function save(id: string, overrides: Partial<SavedPost> = {}): SavedPost {
  return {
    id,
    postId: `reddit:${id}`,
    platform: "reddit",
    url: `https://www.reddit.com/r/running/comments/${id}/`,
    post: {
      id: `reddit:${id}`,
      platform: "reddit",
      url: `https://www.reddit.com/r/running/comments/${id}/`,
      title: `Title ${id}`,
      text: "",
      author: { handle: "runner", name: "runner" },
      metrics: { score: 10 },
      media: { kind: "image", thumbnailUrl: "https://platform.example.com/expiring.jpg" },
      hashtags: [],
      extra: {},
    },
    thumbnailUrl: "https://media.example.com/uploads/images/copy.jpg",
    note: "",
    tags: [],
    source: "picker",
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
    ...overrides,
  }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InspirationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.listSavedPosts.mockReset().mockResolvedValue({ data: [save("a", { note: "great opener", tags: ["hooks"] }), save("b")], nextCursor: null })
  api.updateSavedPost.mockReset()
  api.deleteSavedPost.mockReset()
})

describe("saved post helpers", () => {
  it("the wall shows the copied still, falling back to the platform's link", () => {
    expect(savedPostStill(save("a"))).toBe("https://media.example.com/uploads/images/copy.jpg")
    expect(savedPostStill(save("a", { thumbnailUrl: null }))).toBe("https://platform.example.com/expiring.jpg")
  })

  it("tags typed with commas are stored the server's way", () => {
    expect(parseTagInput(" #Hooks, cold  open ,, hooks")).toEqual(["hooks", "cold open"])
    expect(parseTagInput("フック、書き出し")).toEqual(["フック", "書き出し"])
  })
})

describe("Inspiration page", () => {
  it("lists the saves with their notes and tags", async () => {
    renderPage()
    expect(await screen.findByText("Title a")).toBeInTheDocument()
    expect(screen.getByText("Title b")).toBeInTheDocument()
    expect(screen.getByText("great opener")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "#hooks" })).toBeInTheDocument()
    expect(api.listSavedPosts).toHaveBeenCalledWith({ platform: undefined, tag: undefined, q: undefined, cursor: undefined, limit: 40 })
  })

  it("says how to save a first post when the wall is empty", async () => {
    api.listSavedPosts.mockResolvedValue({ data: [], nextCursor: null })
    renderPage()
    expect(await screen.findByText(en["inspiration.empty"])).toBeInTheDocument()
  })

  it("filters by platform and by a tag clicked on a card", async () => {
    renderPage()
    await screen.findByText("Title a")
    fireEvent.click(screen.getByRole("button", { name: "#hooks" }))
    await waitFor(() => expect(api.listSavedPosts).toHaveBeenLastCalledWith(expect.objectContaining({ tag: "hooks" })))
    fireEvent.click(screen.getByRole("button", { name: /Reddit/ }))
    await waitFor(() => expect(api.listSavedPosts).toHaveBeenLastCalledWith(expect.objectContaining({ platform: "reddit", tag: "hooks" })))
  })

  it("edits a note and tags", async () => {
    api.updateSavedPost.mockResolvedValue(save("a", { note: "new note", tags: ["hooks", "running"] }))
    renderPage()
    await screen.findByText("Title a")
    fireEvent.click(screen.getAllByRole("button", { name: en["inspiration.edit"] })[0]!)

    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByPlaceholderText(en["inspiration.notePlaceholder"]), { target: { value: " new note " } })
    fireEvent.change(within(dialog).getByPlaceholderText(en["inspiration.tagsPlaceholder"]), { target: { value: "hooks, Running" } })
    fireEvent.click(within(dialog).getByRole("button", { name: en["common.save"] }))

    await waitFor(() => expect(api.updateSavedPost).toHaveBeenCalledWith("a", { note: "new note", tags: ["hooks", "running"] }))
  })

  it("removes a save only after the confirmation", async () => {
    api.deleteSavedPost.mockResolvedValue(undefined)
    renderPage()
    await screen.findByText("Title a")
    fireEvent.click(screen.getAllByRole("button", { name: en["inspiration.remove"] })[1]!)
    expect(api.deleteSavedPost).not.toHaveBeenCalled()

    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: en["common.remove"] }))
    await waitFor(() => expect(api.deleteSavedPost).toHaveBeenCalledWith("b"))
  })
})
