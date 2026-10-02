import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { SocialPost } from "@nodaro/shared"
import type { SocialSearchNodeData } from "@/types/nodes"
import { en } from "@/lib/i18n/en"

const api = vi.hoisted(() => ({
  lookupSavedPosts: vi.fn(),
  savePost: vi.fn(),
  deleteSavedPost: vi.fn(),
}))

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SocialPostPicker } from "../social-post-picker"

function post(id: string): SocialPost {
  return {
    id: `tiktok:${id}`,
    platform: "tiktok",
    url: `https://www.tiktok.com/@maker/video/${id}`,
    text: `post ${id}`,
    author: { handle: "maker", name: "Maker" },
    metrics: { views: 10 },
    media: { kind: "video" },
    hashtags: [],
    extra: {},
  }
}

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  api.lookupSavedPosts.mockReset().mockResolvedValue(new Map())
  api.savePost.mockReset()
  api.deleteSavedPost.mockReset()
})

// The picker renders through a portal (Radix Dialog), so queries go through
// `screen` (document.body), never the RTL container.
describe("SocialPostPicker", () => {
  it("renders for a platform this build does not know instead of crashing the node", () => {
    const data = { label: "Social Search", platform: "facebook", searchResults: [post("1")] } as unknown as SocialSearchNodeData
    expect(() => renderWithQuery(<SocialPostPicker data={data} open={false} onOpenChange={() => {}} onApply={() => {}} />)).not.toThrow()
    expect(() => renderWithQuery(<SocialPostPicker data={data} open onOpenChange={() => {}} onApply={() => {}} />)).not.toThrow()
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
  })

  it("shows one card per post found, none picked when the node holds no picks", () => {
    const data = { label: "Social Search", platform: "tiktok", searchResults: [post("1"), post("2"), post("3")] } as SocialSearchNodeData
    renderWithQuery(<SocialPostPicker data={data} open onOpenChange={() => {}} onApply={() => {}} />)
    const cards = screen.getAllByRole("checkbox")
    expect(cards).toHaveLength(3)
    expect(cards.every((c) => c.getAttribute("aria-checked") === "false")).toBe(true)
  })

  it("saves a post to the inspiration wall from its bookmark without picking it", async () => {
    api.savePost.mockResolvedValue({ id: "save-1" })
    const data = { label: "Social Search", platform: "tiktok", searchResults: [post("1")] } as SocialSearchNodeData
    renderWithQuery(<SocialPostPicker data={data} open onOpenChange={() => {}} onApply={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: en["social.saveToWall"] }))

    await waitFor(() => expect(api.savePost).toHaveBeenCalledWith({ post: post("1"), source: "picker" }))
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false")
    expect(await screen.findByRole("button", { name: en["social.savedRemove"] })).toHaveAttribute("aria-pressed", "true")
  })

  it("shows a post already saved as saved, and its bookmark removes the save", async () => {
    api.lookupSavedPosts.mockResolvedValue(new Map([["tiktok:1", "save-9"]]))
    api.deleteSavedPost.mockResolvedValue(undefined)
    const data = { label: "Social Search", platform: "tiktok", searchResults: [post("1"), post("2")] } as SocialSearchNodeData
    renderWithQuery(<SocialPostPicker data={data} open onOpenChange={() => {}} onApply={() => {}} />)

    const saved = await screen.findByRole("button", { name: en["social.savedRemove"] })
    expect(screen.getAllByRole("button", { name: en["social.saveToWall"] })).toHaveLength(1)
    fireEvent.click(saved)

    await waitFor(() => expect(api.deleteSavedPost).toHaveBeenCalledWith("save-9"))
    await waitFor(() => expect(screen.getAllByRole("button", { name: en["social.saveToWall"] })).toHaveLength(2))
  })

  it("saves two posts at once, each bookmark busy only while its own save runs", async () => {
    const pending: Array<(value: { id: string }) => void> = []
    api.savePost.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const data = { label: "Social Search", platform: "tiktok", searchResults: [post("1"), post("2")] } as SocialSearchNodeData
    renderWithQuery(<SocialPostPicker data={data} open onOpenChange={() => {}} onApply={() => {}} />)

    const [first, second] = screen.getAllByRole("button", { name: en["social.saveToWall"] })
    fireEvent.click(first!)
    fireEvent.click(second!)
    await waitFor(() => expect(api.savePost).toHaveBeenCalledTimes(2))
    expect(first).toBeDisabled()
    expect(second).toBeDisabled()

    pending[0]!({ id: "save-1" })
    expect(await screen.findByRole("button", { name: en["social.savedRemove"] })).toBeEnabled()
    expect(screen.getByRole("button", { name: en["social.saveToWall"] })).toBeDisabled()

    pending[1]!({ id: "save-2" })
    await waitFor(() => expect(screen.getAllByRole("button", { name: en["social.savedRemove"] })).toHaveLength(2))
  })
})
