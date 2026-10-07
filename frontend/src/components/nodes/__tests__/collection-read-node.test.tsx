/**
 * The Read Collection card shows the records the last run read the way the
 * Telegram feed shows posts: the first one featured (picture, title, text,
 * the post's date, "Open in <site>" for its link), arrows and thumbnails over
 * the rest, and "View all" listing every record with its link.
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
vi.mock("@/hooks/use-workflow-store", () => {
  const state = { updateNodeData: vi.fn(), runSingleNode: vi.fn() }
  const useWorkflowStore = (select: (s: typeof state) => unknown) => select(state)
  useWorkflowStore.getState = () => state
  return { useWorkflowStore }
})
vi.mock("@/hooks/queries/use-collections-queries", () => ({
  useCollections: () => ({ data: { data: [{ id: "col-1", name: "acme.studio" }] } }),
}))

import { CollectionReadNode } from "../collection-read-node"
import { formatNumber } from "@/lib/i18n/format"

const record = (over: Record<string, unknown>) => ({
  id: "r1",
  collectionId: "col-1",
  title: "",
  text: "",
  url: null,
  media: [],
  fields: {},
  dedupeKey: null,
  source: { via: "node" },
  createdAt: "2026-10-07T11:05:16Z",
  ...over,
})

const FIRST = record({
  id: "r1",
  title: "Our new voices are live",
  text: "Give your characters a voice with emotion in every line.",
  url: "https://www.instagram.com/p/DPabc/",
  media: [{ type: "image", url: "https://cdn.example/a.jpg" }],
  fields: { publishedAt: "2026-10-06T09:00:00Z", views: 1204 },
})
const SECOND = record({
  id: "r2",
  title: "Introducing the Ads Studio",
  text: "The first ROAS-driven static ads content machine.",
  url: "https://www.instagram.com/p/DPdef/",
  media: [{ type: "video", url: "https://cdn.example/b.mp4", posterUrl: "https://cdn.example/b.jpg" }],
})

function renderCard(data: Record<string, unknown>) {
  const props = { id: "cr1", data: { label: "Read Collection", collectionId: "col-1", ...data }, selected: false } as unknown as NodeProps
  return render(<CollectionReadNode {...props} />)
}

describe("CollectionReadNode", () => {
  it("features the first record: its title, text, views, the post's date and Open in Instagram", () => {
    renderCard({ generatedJson: [FIRST, SECOND], generatedText: "x", executionStatus: "completed" })
    expect(screen.getByText("2 records")).toBeInTheDocument()
    expect(screen.getByText(FIRST.title as string)).toBeInTheDocument()
    expect(screen.getByText(FIRST.text as string)).toBeInTheDocument()
    expect(screen.getByText(`${formatNumber(1204)} views`)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Open in Instagram/ })).toHaveAttribute("href", FIRST.url)
    expect(screen.getAllByTestId("post-media")[0]).toHaveAttribute("data-src", "https://cdn.example/a.jpg")
    expect(screen.getByText("1 / 2")).toBeInTheDocument()
  })

  it("the arrows page to the next record, its video's poster as the picture", () => {
    renderCard({ generatedJson: [FIRST, SECOND], generatedText: "x", executionStatus: "completed" })
    fireEvent.click(screen.getByRole("button", { name: "Next post" }))
    expect(screen.getByText(SECOND.title as string)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Open in Instagram/ })).toHaveAttribute("href", SECOND.url)
    expect(screen.getAllByTestId("post-media")[0]).toHaveAttribute("data-src", "https://cdn.example/b.jpg")
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument()
  })

  it("a new run leads with its own first record again", () => {
    const { rerender } = renderCard({ generatedJson: [FIRST, SECOND], generatedText: "x", executionStatus: "completed" })
    fireEvent.click(screen.getByRole("button", { name: "Next post" }))
    expect(screen.getByText("2 / 2")).toBeInTheDocument()
    const third = record({ id: "r3", title: "A newer run's first", url: "https://x.com/a/status/1" })
    const props = { id: "cr1", data: { label: "Read Collection", collectionId: "col-1", generatedJson: [third, FIRST], generatedText: "x", executionStatus: "completed" }, selected: false } as unknown as NodeProps
    rerender(<CollectionReadNode {...props} />)
    expect(screen.getByText("1 / 2")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Open in X/ })).toHaveAttribute("href", "https://x.com/a/status/1")
  })

  it("View all lists every record with its own link", () => {
    renderCard({ generatedJson: [FIRST, SECOND], generatedText: "x", executionStatus: "completed" })
    fireEvent.click(screen.getByRole("button", { name: "View all 2" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Records in acme.studio")).toBeInTheDocument()
    expect(within(dialog).getByText(FIRST.title as string)).toBeInTheDocument()
    expect(within(dialog).getByText(SECOND.title as string)).toBeInTheDocument()
    const links = within(dialog).getAllByRole("link", { name: /Open in Instagram/ })
    expect(links.map((a) => a.getAttribute("href"))).toEqual([FIRST.url, SECOND.url])
  })

  it("a record with no title leads with who posted it; one with no link shows no link", () => {
    renderCard({
      generatedJson: [record({ text: "Nano Banana 2.1 is out", fields: { channel: "tech_cyber_ai_israel" } })],
      generatedText: "x",
      executionStatus: "completed",
    })
    expect(screen.getByText("@tech_cyber_ai_israel")).toBeInTheDocument()
    expect(screen.getByText("Nano Banana 2.1 is out")).toBeInTheDocument()
    expect(screen.getByText("1 record")).toBeInTheDocument()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("a link to any other site opens on that site", () => {
    renderCard({ generatedJson: [record({ title: "A story", url: "https://www.nytimes.com/2026/a.html" })], generatedText: "x", executionStatus: "completed" })
    expect(screen.getByRole("link", { name: /Open in nytimes\.com/ })).toHaveAttribute("href", "https://www.nytimes.com/2026/a.html")
  })

  it("a hand-written record with missing pieces renders instead of taking the canvas down", () => {
    renderCard({
      generatedJson: [{ id: "a", media: [null, { type: "image" }] }, { id: "b", title: 7, fields: "x" }, { title: "no id" }, null, "junk"],
      generatedText: "x",
      executionStatus: "completed",
    })
    expect(screen.getByText("2 records")).toBeInTheDocument()
    expect(screen.getByText("1 / 2")).toBeInTheDocument()
  })

  it("who posted it sits isolated in the date line, so its @ stays in front right to left", () => {
    renderCard({ generatedJson: [{ ...FIRST, fields: { ...(FIRST.fields as object), handle: "acme.studio" } }], generatedText: "x", executionStatus: "completed" })
    expect(screen.getByText("@acme.studio").tagName).toBe("BDI")
    fireEvent.click(screen.getByRole("button", { name: "View all 1" }))
    expect(within(screen.getByRole("dialog")).getByText("@acme.studio").tagName).toBe("BDI")
  })

  it("the inspector is titled by the collection, or plainly when its name is unknown", () => {
    renderCard({ collectionId: "not-in-the-list", generatedJson: [FIRST], generatedText: "x", executionStatus: "completed" })
    fireEvent.click(screen.getByRole("button", { name: "View all 1" }))
    expect(within(screen.getByRole("dialog")).getByText("Collection")).toBeInTheDocument()
  })

  it("before a run it says which collection it reads", () => {
    renderCard({})
    expect(screen.getByText("Reads acme.studio")).toBeInTheDocument()
  })

  it("an empty window says so", () => {
    renderCard({ generatedJson: [], generatedText: "", executionStatus: "completed" })
    expect(screen.getByText("No records in this window")).toBeInTheDocument()
  })

  it("a failed run shows its error", () => {
    renderCard({ executionStatus: "failed", errorMessage: "Collection not found" })
    expect(screen.getByText("Collection not found")).toBeInTheDocument()
  })
})
