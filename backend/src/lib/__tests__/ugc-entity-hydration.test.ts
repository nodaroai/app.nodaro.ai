/**
 * An entity on a creator's photo path keeps no pointer back to the author's library: a run of a
 * published app, a component or a share link hydrates entity nodes from the WORKFLOW OWNER's rows
 * (`hydrateEntityNodes`), so a pointer that shipped would put the author's portrait — and their
 * trained LoRA — back on someone else's run. Both wirings: the entity's image straight into the
 * creator's photo, and the entity into a Generate Image's references. The ids and URLs are
 * placeholders.
 */
import { describe, it, expect, vi } from "vitest"

const PORTRAIT = "https://cdn.example/author-portrait.png"
const ROW = "00000000-0000-4000-8000-00000000c0de"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "eq", "is"]) chain[m] = () => chain
      chain.in = () => chain
      // The author's character row: their portrait.
      chain.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: table === "characters" ? [{ id: ROW, default_asset_url: PORTRAIT, source_image_url: PORTRAIT, expressions: [{ name: "smile", url: PORTRAIT }] }] : [], error: null })
      return chain
    },
  },
}))

import { hydrateEntityNodes } from "../entity-hydration.js"
import { ugcStripPart } from "../ugc-composed-graph.js"
import { ugcComposedKey } from "@nodaro/render-rules"

type N = { id: string; type: string; data: Record<string, unknown> }
const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data: { label: id, ...data } })
const e = (source: string, target: string, targetHandle: string, sourceHandle: string | null = null) => ({ source, target, targetHandle, sourceHandle })
const character = () => n("who", "character", { characterDbId: ROW, characterName: "Me", loraReplicateVersion: "lora-v1", loraTriggerWord: "mytoken", loraTrainingStatus: "succeeded", defaultAssetUrl: PORTRAIT, sourceImageUrl: PORTRAIT })
const creator = () => n("creator", "ugc-creator", { source: "photo" })

describe.each([
  ["the entity's image straight into the creator's photo", () => ({ nodes: [character(), creator()], edges: [e("who", "creator", "photo", "image")] })],
  ["the entity into a Generate Image's references, into the creator's photo", () => ({ nodes: [character(), n("gen", "generate-image", { prompt: "a portrait" }), creator()], edges: [e("who", "gen", "assets", "image"), e("gen", "creator", "photo", "image")] })],
])("%s", (_wiring, graph) => {
  it("ships with no pointer to the author's row and no LoRA, so a run hydrates no portrait onto it", async () => {
    const { nodes, edges } = graph()
    const shipped = ugcStripPart(nodes, edges, undefined, ugcComposedKey([]))
    const who = shipped.find((x) => x.id === "who")!
    expect(who.data).toEqual({ label: "who", characterName: "Me" })
    await hydrateEntityNodes(shipped, "author-1")
    expect(JSON.stringify(shipped)).not.toContain(PORTRAIT)
    expect(JSON.stringify(shipped)).not.toContain("mytoken")
  })

  it("the author's own graph keeps its pointer, and hydrates as it always has", async () => {
    const { nodes } = graph()
    const own = nodes.map((x) => (x.id === "who" ? { ...x, data: { ...x.data, defaultAssetUrl: "", sourceImageUrl: "" } } : x))
    await hydrateEntityNodes(own, "author-1")
    expect(JSON.stringify(own)).toContain(PORTRAIT)
  })
})
