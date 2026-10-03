/**
 * A post on the Social Search node: a text post shows its first words and
 * who wrote it (not a bare letter), and a click opens the whole post.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { SocialPost } from "@nodaro/shared"
import { en } from "@/lib/i18n/en"
import { SocialPostTile } from "../social-post-tile"

function post(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "reddit:1",
    platform: "reddit",
    url: "https://www.reddit.com/r/videography/comments/1/",
    title: "Which gimbal for a first wedding shoot?",
    text: "Long question body",
    author: { handle: "maker", name: "Maker" },
    metrics: {},
    media: { kind: "text" },
    hashtags: [],
    extra: {},
    ...overrides,
  }
}

describe("SocialPostTile", () => {
  it("shows a text post's first words and who wrote it", () => {
    render(<SocialPostTile post={post()} onRead={() => {}} />)
    expect(screen.getByText("Which gimbal for a first wedding shoot?")).toBeInTheDocument()
    expect(screen.getByText("@maker")).toBeInTheDocument()
  })

  it("opens the whole post on a click", () => {
    const onRead = vi.fn()
    render(<SocialPostTile post={post()} onRead={onRead} />)
    fireEvent.click(screen.getByRole("button", { name: `${en["social.readPost"]}: @maker` }))
    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ id: "reddit:1" }))
  })

  it("shows the still of a post that has one, not its words", () => {
    render(<SocialPostTile post={post({ media: { kind: "video", thumbnailUrl: "https://cdn.example.com/s.jpg" } })} onRead={() => {}} />)
    expect(screen.queryByText("Which gimbal for a first wedding shoot?")).toBeNull()
  })
})
