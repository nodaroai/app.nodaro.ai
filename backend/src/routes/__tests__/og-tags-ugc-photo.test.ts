/**
 * The social preview of a published app (`/og/app/:slug`): the app's icon, else
 * the app's preview — a preview the author chose ships exactly as they chose it,
 * whatever it shows — else the published snapshot, where the image is the first
 * node holding media. The UGC template's "Your photo" upload sits before the
 * video, so a snapshot that kept the author's photo in it would hand that face
 * to every crawler. Publishing empties an Upload Image wired into a UGC
 * Creator's photo input (`stripUgcPublishState`), so it never does unless the
 * author picks it as the preview. The URLs are placeholders.
 */
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }))

vi.mock("@/lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "order", "limit"]) chain[m] = () => chain
  chain.single = async () => ({ data: h.row, error: null })
  return { supabase: { from: () => chain } }
})

import { stripUgcPublishState } from "@nodaro/render-rules"
import { ogTagsRoutes } from "../og-tags.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(HERE, "..", "..", "lib", "tutorial-seed", "templates", "ugc-website-video.json")
const AUTHOR = "https://cdn.example/author-face.png"

type Node = { id: string; type: string; data: Record<string, unknown> }
type Edge = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

/**
 * The template as its author left it after a My photo run: their photo in "Your photo", no screenshots, no product photo.
 * The template's example screenshots are cleared, so no earlier image stands in front of the face in the automatic chain.
 */
async function authorsGraph(): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const doc = JSON.parse(await readFile(TEMPLATE, "utf8")) as { nodes: Node[]; edges: Edge[] }
  const nodes = doc.nodes.map((n) =>
    n.type === "upload-image" && n.id !== "photo"
      ? { ...n, data: { label: n.data.label, fieldMappings: n.data.fieldMappings } }
      : n.id === "photo"
      ? { ...n, data: { ...n.data, url: AUTHOR, r2Url: AUTHOR, assetId: "asset-author", generatedResults: [{ url: AUTHOR, jobId: "upload-1", timestamp: "t" }], activeResultIndex: 0 } }
      : n.id === "creator"
        ? { ...n, data: { ...n.data, source: "photo" } }
        : n,
  )
  return { nodes, edges: doc.edges }
}

let app: FastifyInstance

beforeEach(async () => {
  app = Fastify({ logger: false })
  await app.register(ogTagsRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const og = () => app.inject({ method: "GET", url: "/og/app/ugc-app" })

describe("with no preview chosen, an app's social preview never shows the author's photo", () => {
  it("the published snapshot of the template, with no icon: no og:image is the author's face", async () => {
    const { nodes, edges } = await authorsGraph()
    h.row = { name: "UGC app", description: "", icon_url: null, workflow_id: "wf-1", snapshot_nodes: stripUgcPublishState(nodes, edges), thumbnail_node_id: null }
    const res = await og()
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain(AUTHOR)
  })

  it("the photo through a step (an upscale) before the creator: the snapshot shows neither the face nor the step's render of it", async () => {
    const UPSCALED = "https://cdn.example/author-face-upscaled.png"
    const { nodes, edges } = await authorsGraph()
    // The step sits first, so a snapshot that kept its render would hand that to every crawler.
    const step: Node = { id: "step", type: "upscale-image", data: { label: "step", upscaleFactor: 2, generatedImageUrl: UPSCALED, generatedResults: [{ url: UPSCALED, jobId: "job-up", timestamp: "t" }], activeResultIndex: 0 } }
    const rewired = [
      ...edges.filter((e) => !(e.source === "photo" && e.target === "creator")),
      { source: "photo", target: "step", sourceHandle: "image", targetHandle: "image" },
      { source: "step", target: "creator", sourceHandle: "image", targetHandle: "photo" },
    ]
    h.row = { name: "UGC app", description: "", icon_url: null, workflow_id: "wf-1", snapshot_nodes: stripUgcPublishState([step, ...nodes], rewired), thumbnail_node_id: null }
    const res = await og()
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain(AUTHOR)
    expect(res.body).not.toContain(UPSCALED)
  })

  it("the same graph unstripped would have shown it (the check bites)", async () => {
    const { nodes } = await authorsGraph()
    h.row = { name: "UGC app", description: "", icon_url: null, workflow_id: "wf-1", snapshot_nodes: nodes, thumbnail_node_id: null }
    const res = await og()
    expect(res.body).toContain(`og:image" content="${AUTHOR}"`)
  })
})

describe("an app's social preview shows the preview the author chose, as they chose it", () => {
  const TAKE = "https://cdn.example/ugc-take.mp4"
  const ICON = "https://cdn.example/app-icon.png"
  const published = async (extra: Record<string, unknown>) => {
    const { nodes, edges } = await authorsGraph()
    return { name: "UGC app", description: "", icon_url: null, workflow_id: "wf-1", snapshot_nodes: stripUgcPublishState(nodes, edges), thumbnail_node_id: null, ...extra }
  }

  it("their own photo picked as the preview: og:image is the pick, though the snapshot holds none of it", async () => {
    h.row = await published({ preview_media_url: AUTHOR })
    expect(JSON.stringify(h.row.snapshot_nodes)).not.toContain(AUTHOR)
    const res = await og()
    expect(res.body).toContain(`og:image" content="${AUTHOR}"`)
    expect(res.body).toContain(`twitter:image" content="${AUTHOR}"`)
  })

  it("a UGC render picked as the preview, on a thumbnail node the snapshot empties: og:image is the render", async () => {
    h.row = await published({ preview_media_url: TAKE, thumbnail_node_id: "clip" })
    const res = await og()
    expect(res.body).toContain(`og:image" content="${TAKE}"`)
  })

  it("no preview set: the automatic chain reads the published snapshot, never the author's photo", async () => {
    h.row = await published({ preview_media_url: null, thumbnail_node_id: "photo" })
    const res = await og()
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain(AUTHOR)
  })

  it("the app's icon, the author's own choice too, stays first", async () => {
    h.row = await published({ icon_url: ICON, preview_media_url: AUTHOR })
    const res = await og()
    expect(res.body).toContain(`og:image" content="${ICON}"`)
    expect(res.body).not.toContain(AUTHOR)
  })
})
