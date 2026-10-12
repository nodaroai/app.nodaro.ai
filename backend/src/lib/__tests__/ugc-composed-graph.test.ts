/**
 * The one funnel (ugc-composed-graph.ts): the server's read of a composed graph — a sub-workflow's
 * graph as the owner's own, a component's snapshot as its route reads it, each loaded once — and
 * how it fails closed; and how each graph ships (`ugcStripPart`): an outbound node keeps where it
 * sends only when it is not on a photo's path, and a graph the set does not know ships empty. The
 * ids and URLs are placeholders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const db = vi.hoisted(() => ({
  workflows: new Map<string, { owner: string; nodes: unknown[]; edges: unknown[] }>(),
  components: new Map<string, { version: number; snapshot_nodes: unknown[]; snapshot_edges: unknown[]; creator_id: string }>(),
  failing: new Set<string>(),
  failOnce: new Set<string>(),
  queries: [] as Array<{ table: string; filters: Record<string, unknown>; order?: string; limit?: number }>,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const q: { table: string; filters: Record<string, unknown>; order?: string; limit?: number } = { table, filters: {} }
      db.queries.push(q)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (column: string, value: unknown) => {
        q.filters[column] = value
        return chain
      }
      chain.is = (column: string, value: unknown) => {
        q.filters[`is:${column}`] = value
        return chain
      }
      chain.order = (column: string) => {
        q.order = column
        return chain
      }
      chain.limit = (n: number) => {
        q.limit = n
        return chain
      }
      chain.single = async () => {
        const id = q.filters.id as string
        if (db.failing.has(id)) return { data: null, error: { code: "57014", message: "statement timeout" } }
        if (db.failOnce.delete(id)) return { data: null, error: { code: "57014", message: "statement timeout" } }
        const row = db.workflows.get(id)
        return row && row.owner === q.filters.user_id ? { data: { nodes: row.nodes, edges: row.edges }, error: null } : { data: null, error: { code: "PGRST116" } }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        const slug = q.filters.slug as string
        if (db.failing.has(slug)) return resolve({ data: null, error: { message: "down" } })
        const row = db.components.get(slug)
        const fits = row && (q.filters.version === undefined || q.filters.version === row.version)
        return resolve({ data: fits ? [row] : [], error: null })
      }
      return chain
    },
  },
}))

import { ugcComposedKey } from "@nodaro/render-rules"
import { UgcGraphReadError, loadUgcComposedGraph, ugcPublishedGraph, ugcStripPart } from "../ugc-composed-graph.js"
import { config } from "../config.js"

const OWNER = "author-1"
type N = { id: string; type: string; data: Record<string, unknown> }
const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data: { label: id, ...data } })
const e = (source: string, target: string, targetHandle = "in", sourceHandle: string | null = null) => ({ source, target, targetHandle, sourceHandle })
const ROOT = ugcComposedKey([])
const RENDER = "https://cdn.example/author-take.mp4"
const POSTED = "https://social.example/post/42"
const HOOK = "https://hooks.example/author-cms"

beforeEach(() => {
  db.workflows.clear()
  db.components.clear()
  db.failing.clear()
  db.failOnce.clear()
  db.queries.length = 0
})

describe("an outbound node keeps where it sends only when nothing of it can reach a creator's photo", () => {
  it("made from the video: a publisher keeps its account and privacy, a webhook its address; what the run left goes", () => {
    const nodes = [
      n("clip", "ugc-clip", { generatedVideoUrl: RENDER }),
      n("post", "x-post", { platform: "x", connectionId: "conn-1", privacy: "public", caption: "new video", platformPostUrl: POSTED, platformPostId: "42", executionStatus: "completed" }),
      n("hook", "webhook-output", { url: HOOK, credentialId: "cred-1", webhookStatusCode: 200, webhookResponseBody: RENDER }),
    ]
    const shipped = new Map(ugcStripPart(nodes, [e("clip", "post", "video", "video-out"), e("clip", "hook", "in", "video-out")], undefined, ROOT).map((x) => [x.id, x.data]))
    expect(shipped.get("post")).toEqual({ label: "post", platform: "x", connectionId: "conn-1", privacy: "public", caption: "new video" })
    expect(shipped.get("hook")).toEqual({ label: "hook", url: HOOK, credentialId: "cred-1" })
  })

  it("on a photo's path: a fetcher's source goes with everything else it holds", () => {
    const nodes = [n("scrape", "web-scrape", { url: "https://author.example/me", actor: "page" }), n("c", "ugc-creator", { source: "photo" })]
    const shipped = new Map(ugcStripPart(nodes, [e("scrape", "c", "photo", "image")], undefined, ROOT).map((x) => [x.id, x.data]))
    expect(shipped.get("scrape")).toEqual({ label: "scrape", actor: "page" })
  })

  it("a graph the set does not know ships with every node empty — its configuration kept", () => {
    const nodes = [n("up", "upload-image", { url: RENDER, assetId: "a-1" }), n("g", "generate-image", { prompt: "a cat", generatedImageUrl: RENDER })]
    const sets = { strip: new Map([[ROOT, new Set<string>()]]), photo: new Map() }
    const shipped = new Map(ugcStripPart(nodes, [], sets, ugcComposedKey(["unknown"])).map((x) => [x.id, x.data]))
    expect(shipped.get("up")).toEqual({ label: "up" })
    expect(shipped.get("g")).toEqual({ label: "g", prompt: "a cat" })
  })
})

describe("the read fails closed", () => {
  const parent = (data: Record<string, unknown> = {}) => [n("s", "sub-workflow", { workflowId: "wf-child", outputResults: { p1: RENDER }, generatedResults: [{ url: RENDER }], ...data }), n("after", "combine-videos", { transition: "cut", generatedVideoUrl: RENDER })]
  const edges = [e("s", "after", "in", "out_p1")]

  it("a child that does not load — deleted, or not the owner's — makes its node a root: its saved outputs and what is made from them ship empty", async () => {
    const published = await ugcPublishedGraph(parent(), edges, OWNER)
    expect(JSON.stringify(published.nodes)).not.toContain(RENDER)
    db.workflows.set("wf-child", { owner: "someone-else", nodes: [n("g", "generate-image")], edges: [] })
    expect(JSON.stringify((await ugcPublishedGraph(parent(), edges, OWNER)).nodes)).not.toContain(RENDER)
  })

  it("a child that loads and holds no UGC video keeps its outputs, as any node does", async () => {
    db.workflows.set("wf-child", { owner: OWNER, nodes: [n("g", "generate-image")], edges: [] })
    expect(JSON.stringify((await ugcPublishedGraph(parent(), edges, OWNER)).nodes)).toContain(RENDER)
  })

  it("a read that fails with an error: a publish is refused (nothing to write), a read or a run strips the node", async () => {
    db.failing.add("wf-child")
    await expect(ugcPublishedGraph(parent(), edges, OWNER, { failOnError: true })).rejects.toBeInstanceOf(UgcGraphReadError)
    expect(JSON.stringify((await ugcPublishedGraph(parent(), edges, OWNER)).nodes)).not.toContain(RENDER)
  })

  it("each child is loaded once per read", async () => {
    db.workflows.set("wf-child", { owner: OWNER, nodes: [n("g", "generate-image")], edges: [] })
    const many = [0, 1, 2, 3].map((i) => n(`s${i}`, "sub-workflow", { workflowId: "wf-child" }))
    const read = await loadUgcComposedGraph(many, [], OWNER)
    expect(read.loads).toBe(1)
    expect(db.queries.filter((q) => q.table === "workflows")).toHaveLength(1)
  })
})

describe("a component node is read as its route reads it", () => {
  it("its snapshot by slug — a component's, active, not deleted — at its pinned version, else the latest; one holding a UGC video is a root", async () => {
    db.components.set("ugc-maker", { version: 3, snapshot_nodes: [n("clip", "ugc-clip")], snapshot_edges: [], creator_id: "component-creator" })
    const nodes = [n("comp", "component", { appSlug: "ugc-maker", pinnedVersion: 3, outputResults: { out: RENDER }, generatedResults: [{ url: RENDER }] })]
    const published = await ugcPublishedGraph(nodes, [], OWNER)
    expect(JSON.stringify(published.nodes)).not.toContain(RENDER)
    const query = db.queries.find((q) => q.table === "published_apps")!
    expect(query.filters).toMatchObject({ slug: "ugc-maker", publish_type: "component", is_active: true, "is:deleted_at": null, version: 3 })
    db.queries.length = 0
    await ugcPublishedGraph([n("comp", "component", { appSlug: "ugc-maker" })], [], OWNER)
    expect(db.queries.find((q) => q.table === "published_apps")).toMatchObject({ order: "version", limit: 1 })
  })
})

describe("the workflow's character definitions ship without a tainted picture", () => {
  const MINE = "https://cdn.example/author-character.png"
  const BRAND = "https://cdn.example/brand-mascot.png"
  const definitions = () => [
    { id: "def-me", name: "Me", type: "reference", referenceImageUrl: MINE },
    { id: "def-brand", name: "Mascot", type: "reference", referenceImageUrl: BRAND },
  ]
  const creator = () => n("creator", "ugc-creator", { source: "photo" })
  const settingsOf = async (nodes: N[], edges: ReturnType<typeof e>[]) => {
    const published = await ugcPublishedGraph(nodes, edges, OWNER, { settings: { presentationSettings: { runTarget: "workflow" }, characterDefinitions: definitions() } })
    return { published, defs: (published.settings?.characterDefinitions ?? []) as Array<Record<string, unknown>> }
  }

  it("one a generator on a creator's photo path draws on loses its picture — and that picture is tainted wherever else it is; one drawn on elsewhere keeps it", async () => {
    const nodes = [
      n("gen", "generate-image", { prompt: "me", characterDefinitionIds: ["def-me"] }), creator(),
      n("clip", "ugc-clip"), n("overlay", "video-overlay", { layers: [{ imageUrl: MINE }, { imageUrl: BRAND }], layerCount: 2 }),
      n("mascot", "generate-image", { prompt: "a mascot", characterDefinitionIds: ["def-brand"] }),
    ]
    const { published, defs } = await settingsOf(nodes, [e("gen", "creator", "photo", "image"), e("clip", "overlay", "video", "video-out")])
    expect(defs).toEqual([{ id: "def-me", name: "Me", type: "reference" }, { id: "def-brand", name: "Mascot", type: "reference", referenceImageUrl: BRAND }])
    expect(published.settings?.presentationSettings).toEqual({ runTarget: "workflow" })
    const overlay = published.nodes.find((x) => x.id === "overlay")!
    expect(overlay.data).toEqual({ label: "overlay", layers: [{ imageUrl: BRAND }], layerCount: 2 })
  })

  it("one a Scene on the photo's path names among its characters loses its picture", async () => {
    const nodes = [n("scene", "scene", { characters: [{ assetId: "def-me", mood: "calm" }] }), creator()]
    const { defs } = await settingsOf(nodes, [e("scene", "creator", "photo", "image")])
    expect(defs.find((d) => d.id === "def-me")).not.toHaveProperty("referenceImageUrl")
    expect(defs.find((d) => d.id === "def-brand")).toHaveProperty("referenceImageUrl", BRAND)
  })

  it("one whose picture is a tainted value itself — a Character on the photo's path holding it — loses it", async () => {
    const nodes = [n("who", "character", { characterName: "Me", sourceImageUrl: `${MINE}?w=512` }), creator()]
    const { defs } = await settingsOf(nodes, [e("who", "creator", "photo", "image")])
    expect(defs.find((d) => d.id === "def-me")).not.toHaveProperty("referenceImageUrl")
    expect(defs.find((d) => d.id === "def-brand")).toHaveProperty("referenceImageUrl", BRAND)
  })

  it("with no node on a photo's path naming one, the settings ship as they are", async () => {
    const settings = { characterDefinitions: definitions() }
    const published = await ugcPublishedGraph([n("mascot", "generate-image", { characterDefinitionIds: ["def-me"] })], [], OWNER, { settings })
    expect(published.settings).toBe(settings)
  })
})

describe("an address on our own storage is the object it names, on any of its hosts", () => {
  const hosts = config as unknown as { R2_PUBLIC_URL: string; R2_PUBLIC_FALLBACK_DOMAIN?: string }
  const saved = { url: hosts.R2_PUBLIC_URL, fallback: hosts.R2_PUBLIC_FALLBACK_DOMAIN }
  beforeEach(() => {
    hosts.R2_PUBLIC_URL = "https://media.nodaro.test"
    hosts.R2_PUBLIC_FALLBACK_DOMAIN = "fallback.nodaro.test"
  })
  afterEach(() => {
    hosts.R2_PUBLIC_URL = saved.url
    hosts.R2_PUBLIC_FALLBACK_DOMAIN = saved.fallback
  })

  it("a layer naming the take on the fallback host goes; one naming another object stays", async () => {
    const nodes = [
      n("clip", "ugc-clip", { generatedVideoUrl: "https://media.nodaro.test/uploads/take-1.mp4" }),
      n("overlay", "video-overlay", { layers: [{ videoUrl: "https://fallback.nodaro.test/uploads/take-1.mp4" }, { imageUrl: "https://fallback.nodaro.test/uploads/logo.png" }], layerCount: 2 }),
    ]
    const published = await ugcPublishedGraph(nodes, [e("clip", "overlay", "video", "video-out")], OWNER)
    expect(published.nodes.find((x) => x.id === "overlay")!.data).toEqual({ label: "overlay", layers: [{ imageUrl: "https://fallback.nodaro.test/uploads/logo.png" }], layerCount: 2 })
  })
})

describe("a composition with no UGC video ships as it is", () => {
  const GEN = "https://cdn.example/brief-render.png"
  it("an unconfigured sub-workflow node and a component node naming nothing are plain nodes: nothing that feeds them is emptied", async () => {
    const nodes = [
      n("brief", "text-prompt", { text: "a red bike" }),
      n("gen", "generate-image", { prompt: "{brief}", generatedImageUrl: GEN }),
      n("unset", "sub-workflow"),
      n("bare", "component"),
    ]
    const edges = [e("brief", "gen", "prompt", "text"), e("brief", "unset", "in_i1", "text"), e("gen", "bare", "image", "image")]
    const published = await ugcPublishedGraph(nodes, edges, OWNER, { failOnError: true })
    expect(published.nodes).toEqual(nodes)
    expect(db.queries).toHaveLength(0)
  })

  it("a sub-workflow node naming nothing but holding outputs is a root: its outputs, and what is made from them, ship empty", async () => {
    const nodes = [n("leftover", "sub-workflow", { generatedResults: [{ url: GEN }], outputResults: { p1: GEN } }), n("after", "upscale-image", { upscaleFactor: 2, generatedImageUrl: GEN })]
    const published = await ugcPublishedGraph(nodes, [e("leftover", "after", "image", "out_p1")], OWNER)
    expect(JSON.stringify(published.nodes)).not.toContain(GEN)
  })

  it("fifty sub-workflow nodes on one helper, holding four into one leaf (251 places, 2 graphs), ship as they are", async () => {
    const LOGO = "https://cdn.example/logo.png"
    db.workflows.set("wf-helper", { owner: OWNER, nodes: [0, 1, 2, 3].map((i) => n(`h${i}`, "sub-workflow", { workflowId: "wf-leaf" })), edges: [] })
    db.workflows.set("wf-leaf", { owner: OWNER, nodes: [n("logo", "upload-image", { url: LOGO })], edges: [] })
    const nodes = [
      ...Array.from({ length: 50 }, (_, i) => n(`s${i}`, "sub-workflow", { workflowId: "wf-helper", generatedResults: [{ url: `${GEN}?i=${i}` }] })),
      n("after", "generate-image", { prompt: "x", generatedImageUrl: GEN }),
    ]
    const published = await ugcPublishedGraph(nodes, [e("s0", "after", "image", "out_p1")], OWNER, { failOnError: true })
    expect(published.nodes).toEqual(nodes)
    expect(db.queries.filter((q) => q.table === "workflows")).toHaveLength(2)
    // At run time each place of the leaf is known to the set, and keeps its logo.
    expect(ugcStripPart(db.workflows.get("wf-leaf")!.nodes as N[], [], published.sets, ugcComposedKey(["s37", "h3"]))).toEqual(db.workflows.get("wf-leaf")!.nodes)
  })
})

describe("a load that fails with an error is asked again when the caller says so", () => {
  const RENDER2 = "https://cdn.example/child-render.png"
  const parent = () => [n("s", "sub-workflow", { workflowId: "wf-flaky", outputResults: { p1: RENDER2 } })]

  it("once more: a graph that loads the second time is read, and keeps its outputs", async () => {
    db.workflows.set("wf-flaky", { owner: OWNER, nodes: [n("g", "generate-image")], edges: [] })
    db.failOnce.add("wf-flaky")
    const published = await ugcPublishedGraph(parent(), [], OWNER, { retryErrors: 1 })
    expect(published.readFailed).toBe(false)
    expect(JSON.stringify(published.nodes)).toContain(RENDER2)
  })

  it("without the retry, the same failure is read as holding a UGC video, and told", async () => {
    db.workflows.set("wf-flaky", { owner: OWNER, nodes: [n("g", "generate-image")], edges: [] })
    db.failOnce.add("wf-flaky")
    const published = await ugcPublishedGraph(parent(), [], OWNER)
    expect(published.readFailed).toBe(true)
    expect(JSON.stringify(published.nodes)).not.toContain(RENDER2)
  })
})
