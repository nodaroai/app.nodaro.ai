/**
 * Reading a whole post: the window opened from "Read" on a picker card shows
 * every word and the post's link, which it opens or copies with a message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { SocialPost } from "@nodaro/shared"
import type { SocialSearchNodeData } from "@/types/nodes"
import { en } from "@/lib/i18n/en"

const api = vi.hoisted(() => ({
  lookupSavedPosts: vi.fn(),
  savePost: vi.fn(),
  deleteSavedPost: vi.fn(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("sonner", () => ({ toast }))

import { SocialPostPicker } from "../social-post-picker"
import { SocialPostPreview } from "../social-post-preview"

const LONG = "First line of a long Reddit post.\n\nSecond paragraph that the card cuts off, with the details people came for."

function post(id: string, overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: `reddit:${id}`,
    platform: "reddit",
    url: `https://www.reddit.com/r/videography/comments/${id}/`,
    title: `Thread ${id}`,
    text: LONG,
    author: { handle: "maker", name: "Maker" },
    container: "r/videography",
    publishedAt: "2026-10-01T10:00:00Z",
    metrics: { score: 120, comments: 14 },
    media: { kind: "text" },
    hashtags: [],
    extra: {},
    ...overrides,
  }
}

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  api.lookupSavedPosts.mockReset().mockResolvedValue(new Map())
  toast.success.mockReset()
  Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } })
})

describe("reading a whole post", () => {
  it("opens from Read on a picker card, without picking it, with every word and the link", async () => {
    const data = { label: "Social Search", platform: "reddit", searchResults: [post("1")] } as SocialSearchNodeData
    renderWithQuery(<SocialPostPicker data={data} open onOpenChange={() => {}} onApply={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: new RegExp(en["social.readPost"]) }))

    const reading = await screen.findByRole("dialog", { name: "@maker" })
    expect(within(reading).getByText(/Second paragraph that the card cuts off/)).toBeInTheDocument()
    expect(within(reading).getByText("https://www.reddit.com/r/videography/comments/1/")).toBeInTheDocument()
    expect(within(reading).getByRole("link", { name: new RegExp(en["social.openPost"]) })).toHaveAttribute("href", "https://www.reddit.com/r/videography/comments/1/")
    // The picker behind the open window is hidden from the accessibility tree.
    expect(screen.getByRole("checkbox", { hidden: true })).toHaveAttribute("aria-checked", "false")
  })

  it("copies the link and says so", async () => {
    renderWithQuery(<SocialPostPreview post={post("2")} onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en["cfgshared.copyUrl"]) }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://www.reddit.com/r/videography/comments/2/"))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(en["node.urlCopied"]))
  })

  it("shows no link row for a post whose link is not http(s)", () => {
    renderWithQuery(<SocialPostPreview post={post("3", { url: "javascript:alert(1)" })} onOpenChange={() => {}} />)
    expect(screen.queryByRole("link", { name: new RegExp(en["social.openPost"]) })).toBeNull()
  })
})
