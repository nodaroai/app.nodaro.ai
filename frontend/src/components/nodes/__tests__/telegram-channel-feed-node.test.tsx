/**
 * The Telegram Channel Feed card: the newest post featured (its text, the
 * channel and post number, the views, the date and forwarded-from, a link to
 * the post), arrows and a thumbnail strip over the rest, and "View all"
 * opening every post of the last run. The card is drawn by the shared post
 * feed card, so this pins what a Telegram post looks like on it.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import type { NodeProps } from "@xyflow/react"

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    useStore: vi.fn(() => 1),
  }
})
vi.mock("@/components/nodes/base-node", () => ({
  BaseNode: ({ children }: { children?: import("react").ReactNode }) => <div data-testid="base-node">{children}</div>,
}))
vi.mock("@/components/nodes/editable-node-label", () => ({
  EditableNodeLabel: ({ label }: { label?: string }) => <span data-testid="editable-node-label">{label}</span>,
}))
vi.mock("@/components/nodes/handle-with-popover", () => ({
  HandleWithPopover: () => null,
  TEXT_HANDLE_COLOR: "#000",
}))
vi.mock("@/components/nodes/run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("@/components/nodes/meta-ad-media", () => ({
  MetaAdMedia: ({ src, initial, children }: { src: string | null; initial: string; children?: import("react").ReactNode }) => (
    <div data-testid="post-media" data-src={src ?? ""}>
      {initial}
      {children}
    </div>
  ),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (select: (s: Record<string, unknown>) => unknown) => select({ updateNodeData: vi.fn(), runSingleNode: vi.fn(), workflowId: "wf-1" }),
}))
vi.mock("@/hooks/queries/use-telegram-feed-queries", () => ({
  useTelegramFeedCursor: () => ({ data: { lastSeenId: 3392 } }),
}))
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 10 }))

import { TelegramChannelFeedNode } from "../telegram-channel-feed-node"

const OLDER = {
  id: 3391,
  channel: "tech_cyber_ai_israel",
  postUrl: "https://t.me/tech_cyber_ai_israel/3391",
  text: "Nano Banana 2.1 is out on OpenRouter",
  date: "2026-10-06T16:57:00Z",
  media: [],
  views: "184",
}
const NEWER = {
  id: 3392,
  channel: "tech_cyber_ai_israel",
  postUrl: "https://t.me/tech_cyber_ai_israel/3392",
  text: "Slovenia registered 200,000 domains",
  date: "2026-10-06T19:26:00Z",
  media: [{ type: "photo", url: "https://cdn4.telesco.pe/file/a.jpg" }],
  views: "119",
  forwardedFrom: { name: "Tech Israel" },
}

function renderCard(data: Record<string, unknown>) {
  const props = { id: "tg1", data: { label: "Telegram Feed", channel: "tech_cyber_ai_israel", ...data }, selected: false } as unknown as NodeProps
  return render(<TelegramChannelFeedNode {...props} />)
}

describe("TelegramChannelFeedNode", () => {
  it("features the newest post: its channel and number, views, text, forwarded-from and a link to it", () => {
    renderCard({ generatedJson: [OLDER, NEWER], generatedText: "x", executionStatus: "completed" })
    expect(screen.getByText("@tech_cyber_ai_israel · #3392")).toBeInTheDocument()
    expect(screen.getByText("119 views")).toBeInTheDocument()
    expect(screen.getByText(NEWER.text)).toBeInTheDocument()
    expect(screen.getByText(/Forwarded from Tech Israel/)).toBeInTheDocument()
    const open = screen.getByRole("link", { name: /Open in Telegram/ })
    expect(open).toHaveAttribute("href", NEWER.postUrl)
    expect(screen.getByText("2 new posts")).toBeInTheDocument()
    expect(screen.getByText("1 / 2")).toBeInTheDocument()
    expect(screen.getByText("Last seen #3392")).toBeInTheDocument()
  })

  it("the arrows page to the older post", () => {
    renderCard({ generatedJson: [OLDER, NEWER], generatedText: "x", executionStatus: "completed" })
    fireEvent.click(screen.getByRole("button", { name: "Next post" }))
    expect(screen.getByText(OLDER.text)).toBeInTheDocument()
    expect(screen.getByText("2 / 2")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Open in Telegram/ })).toHaveAttribute("href", OLDER.postUrl)
  })

  it("View all lists every post with its own link", () => {
    renderCard({ generatedJson: [OLDER, NEWER], generatedText: "x", executionStatus: "completed" })
    fireEvent.click(screen.getByRole("button", { name: "View all 2" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Posts from @tech_cyber_ai_israel")).toBeInTheDocument()
    expect(within(dialog).getByText(NEWER.text)).toBeInTheDocument()
    expect(within(dialog).getByText(OLDER.text)).toBeInTheDocument()
    const links = within(dialog).getAllByRole("link", { name: /Open in Telegram/ })
    expect(links.map((a) => a.getAttribute("href"))).toEqual([NEWER.postUrl, OLDER.postUrl])
  })

  it("a thumbnail picks the post it shows", () => {
    renderCard({ generatedJson: [OLDER, NEWER], generatedText: "x", executionStatus: "completed" })
    const thumbs = screen.getAllByRole("button").filter((b) => b.querySelector("[data-testid=\"post-media\"]"))
    expect(thumbs).toHaveLength(2)
    fireEvent.click(thumbs[1])
    expect(screen.getByText(OLDER.text)).toBeInTheDocument()
    expect(thumbs[1]).toHaveAttribute("aria-current", "true")
  })

  it("a video Telegram gives no file for plays in Telegram", () => {
    renderCard({
      generatedJson: [{ ...NEWER, media: [{ type: "video", posterUrl: "https://cdn4.telesco.pe/file/p.jpg" }] }],
      generatedText: "x",
      executionStatus: "completed",
    })
    expect(screen.getByRole("link", { name: "Watch in Telegram" })).toHaveAttribute("href", NEWER.postUrl)
    expect(screen.queryByRole("button", { name: "Play video" })).toBeNull()
  })

  it("a video with a file plays here", () => {
    renderCard({
      generatedJson: [{ ...NEWER, media: [{ type: "video", url: "https://cdn4.telesco.pe/file/v.mp4", posterUrl: "https://cdn4.telesco.pe/file/p.jpg" }] }],
      generatedText: "x",
      executionStatus: "completed",
    })
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Watch in Telegram" })).toBeNull()
  })

  it("a video whose file does not load falls back to Watch in Telegram", () => {
    const { container } = renderCard({
      generatedJson: [{ ...NEWER, media: [{ type: "video", url: "https://cdn4.telesco.pe/file/v.mp4", posterUrl: "https://cdn4.telesco.pe/file/p.jpg" }] }],
      generatedText: "x",
      executionStatus: "completed",
    })
    fireEvent.click(screen.getByRole("button", { name: "Play video" }))
    const video = container.querySelector("video")
    expect(video).not.toBeNull()
    fireEvent.error(video as HTMLVideoElement)
    expect(container.querySelector("video")).toBeNull()
    expect(screen.getByRole("link", { name: "Watch in Telegram" })).toHaveAttribute("href", NEWER.postUrl)
  })

  it("a run that found nothing says so", () => {
    renderCard({ generatedJson: [], generatedText: "", executionStatus: "completed" })
    expect(screen.getAllByText("Nothing new").length).toBeGreaterThan(0)
    expect(screen.queryByRole("link", { name: /Open in Telegram/ })).toBeNull()
  })

  it("never renders a post link that is not http(s): post data is untrusted", () => {
    renderCard({ generatedJson: [{ ...NEWER, postUrl: "javascript:alert(1)" }], generatedText: "x", executionStatus: "completed" })
    expect(screen.getByText(NEWER.text)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Open in Telegram/ })).toBeNull()
  })
})
