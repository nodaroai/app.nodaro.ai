import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import type { SocialPost } from "@nodaro/shared"
import type { SocialSearchNodeData } from "@/types/nodes"
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

// The picker renders through a portal (Radix Dialog), so queries go through
// `screen` (document.body), never the RTL container.
describe("SocialPostPicker", () => {
  it("renders for a platform this build does not know instead of crashing the node", () => {
    const data = { label: "Social Search", platform: "facebook", searchResults: [post("1")] } as unknown as SocialSearchNodeData
    expect(() => render(<SocialPostPicker data={data} open={false} onOpenChange={() => {}} onApply={() => {}} />)).not.toThrow()
    expect(() => render(<SocialPostPicker data={data} open onOpenChange={() => {}} onApply={() => {}} />)).not.toThrow()
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
  })

  it("shows one card per post found, none picked when the node holds no picks", () => {
    const data = { label: "Social Search", platform: "tiktok", searchResults: [post("1"), post("2"), post("3")] } as SocialSearchNodeData
    render(<SocialPostPicker data={data} open onOpenChange={() => {}} onApply={() => {}} />)
    const cards = screen.getAllByRole("checkbox")
    expect(cards).toHaveLength(3)
    expect(cards.every((c) => c.getAttribute("aria-checked") === "false")).toBe(true)
  })
})
