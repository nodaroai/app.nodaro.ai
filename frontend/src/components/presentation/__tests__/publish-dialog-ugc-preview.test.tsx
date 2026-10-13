/**
 * The preview a MiniApp is published with. Publishing ships every UGC node, and
 * everything made from the UGC video, empty — a sub-workflow whose graph holds one
 * among them, which only the server can see — and every node on a path into the
 * creator's photo input with no image (stripUgcPublishState). So the dialog sends
 * no preview of its own: the server derives it from what it publishes, and never
 * picks one of those renders or the author's photo. The thumbnail the author
 * picked is theirs to show, and the dialog sends it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({ edges: [] as unknown[], publish: vi.fn(), existing: null as Record<string, unknown> | null }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAppByWorkflow: vi.fn(async () => h.existing),
  publishApp: (...a: unknown[]) => h.publish(...a),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }))
vi.mock("@/hooks/use-workflow-store", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>()
  return { ...orig, useWorkflowStore: (selector: (s: { edges: unknown[] }) => unknown) => selector({ edges: h.edges }) }
})

import { PublishDialog } from "../publish-dialog"
import { tx } from "@/lib/i18n"
import type { WorkflowNode } from "@/types/nodes"

const TAKE = "https://cdn.example/take.mp4"
const JOINED = "https://cdn.example/joined.mp4"
const OUTRO = "https://cdn.example/outro.mp4"
const OUTSIDE = "https://cdn.example/outside.mp4"
const PHOTO = "https://cdn.example/author-face.png"

const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const e = (source: string, target: string, targetHandle: string, sourceHandle: string | null = null) => ({ id: `${source}-${target}-${targetHandle}`, source, target, targetHandle, sourceHandle })
const video = (url: string) => ({ generatedVideoUrl: url, generatedResults: [{ url, jobId: "job-1", timestamp: "2026-10-09T09:00:00.000Z" }], activeResultIndex: 0 })

// The author's photo upload and the UGC video's nodes come first: a fallback over the author's own
// nodes would pick the photo, the take, or the outro made from the video.
const NODES = [
  n("photo", "upload-image", { url: PHOTO, r2Url: PHOTO, assetId: "asset-author", generatedResults: [{ url: PHOTO, jobId: "upload-1", timestamp: "2026-10-09T09:00:00.000Z" }], activeResultIndex: 0 }),
  n("creator", "ugc-creator", { source: "photo", gender: "woman" }),
  n("clips", "ugc-clips"),
  n("clip", "ugc-clip", video(TAKE)),
  n("cards", "ugc-cards"),
  n("join", "combine-videos", { transition: "cut", ...video(JOINED) }),
  n("outro", "combine-videos", { transition: "cut", ...video(OUTRO) }),
  n("outside", "generate-video", { prompt: "a cat", ...video(OUTSIDE) }),
]
const EDGES = [
  e("photo", "creator", "photo", "image"), e("creator", "clips", "creator", "creator"),
  e("clips", "clip", "clip", "clips"), e("clip", "join", "in"), e("clip", "cards", "notes"), e("clips", "cards", "plan", "plan-out"), e("join", "cards", "video"),
  e("join", "outro", "in"),
]

beforeEach(() => {
  h.edges = EDGES
  h.existing = null
  h.publish.mockReset()
  h.publish.mockResolvedValue({ slug: "s" })
})

async function publish(): Promise<Record<string, unknown>> {
  render(<PublishDialog workflowId="wf-1" nodes={NODES} updatePresentationSettings={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: tx("pubDialog.trigger") }))
  const name = await screen.findByPlaceholderText(tx("pubDialog.namePlaceholder"))
  if (!(name as HTMLInputElement).value) fireEvent.change(name, { target: { value: "A UGC app" } })
  fireEvent.click(screen.getByRole("button", { name: tx("pubDialog.publishAppSubmit") }))
  await waitFor(() => expect(h.publish).toHaveBeenCalled())
  return h.publish.mock.calls[0]![0] as Record<string, unknown>
}

describe("the publish dialog's preview and a UGC video", () => {
  it("with no thumbnail picked, the dialog sends no preview: the server derives it from what it publishes", async () => {
    const body = await publish()
    expect(body.previewMediaUrl).toBeUndefined()
    expect(body.previewMediaType).toBeUndefined()
    // Never the author's photo, the take, the joined video or the outro made from it.
    for (const own of [PHOTO, TAKE, JOINED, OUTRO]) expect(JSON.stringify(body), own).not.toContain(own)
  })

  it("the thumbnail the author picked is theirs to show", async () => {
    h.existing = { name: "A UGC app", slug: "a-ugc-app", description: "", thumbnailNodeId: "clip", isListed: false, category: "other", outputTypes: [], tags: [], supportsRemix: false, publishType: "app" }
    const body = await publish()
    expect(body.previewMediaUrl).toBe(TAKE)
  })
})
