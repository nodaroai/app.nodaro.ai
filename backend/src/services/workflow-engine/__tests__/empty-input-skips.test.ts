import { describe, expect, it } from "vitest"
import { computeEmptyInputSkipIds } from "../empty-input-skips.js"
import { computeGatedIds } from "../execution-graph.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

/**
 * The run-time skip for a node with nothing to work on (decided 2026-10-05):
 * a TEXT-REQUIRING node is skipped when the text it would send is empty AND a
 * wired input came from a node that, in THIS run, produced nothing — and the
 * router gate generalized to run-time skipped sources, carrying the reason.
 */
const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data })
const edge = (source: string, target: string, sourceHandle = "text", targetHandle = "prompt"): SimpleEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  sourceHandle,
  targetHandle,
})

const nodes: SimpleNode[] = [
  node("feed", "telegram-channel-feed", { channel: "news" }),
  node("feed2", "telegram-channel-feed", { channel: "tech" }),
  node("combine", "combine-text"),
  node("llm", "llm-chat"),
  node("typed", "llm-chat", { userInput: "Write a poem about rain" }),
  node("tts", "text-to-speech"),
  node("gen", "generate-image"),
  node("lonely", "llm-chat"),
  node("split", "split-text"),
  node("fan", "llm-chat"),
]
const edges: SimpleEdge[] = [
  edge("feed", "combine", "text", "text"),
  edge("feed2", "combine", "text", "text"),
  edge("combine", "llm"),
  edge("combine", "typed"),
  edge("llm", "tts"),
  edge("combine", "gen"),
  edge("split", "fan"),
]

const completed = (text: string): NodeExecutionState => ({ status: "completed", output: { text } })
const seeded = (text: string): NodeExecutionState => ({ status: "completed", output: { text }, fromSavedData: true })

const level = (...ids: string[]) => nodes.filter((n) => ids.includes(n.id))

describe("computeEmptyInputSkipIds", () => {
  // An output node sends exactly what is wired into it (decided 2026-10-07): a
  // run in which the filter before the site's webhook kept no story would have
  // POSTed an empty payload (the site answers 400 and alerts its owner); the
  // Telegram post behind a filter that kept nothing would have failed the run.
  describe("output nodes with nothing wired this run", () => {
    const graph: SimpleNode[] = [
      node("siteOnly", "filter-list", { conditions: [] }),
      node("hook", "webhook-output", { url: "https://site.example.test/ingest", params: [{ id: "article", name: "article", type: "text" }] }),
      node("posts", "extract-field", { field: "post", outputType: "list" }),
      node("pics", "generate-image", { prompt: "" }),
      node("tg", "telegram-post", { caption: "" }),
      node("typedTg", "telegram-post", { caption: "Good morning" }),
    ]
    const wires: SimpleEdge[] = [
      edge("siteOnly", "hook", "out", "article"),
      edge("posts", "tg", "text", "in"),
      edge("pics", "tg", "image", "in"),
    ]
    const emptyList: NodeExecutionState = { status: "completed", output: { text: "", listResults: [] } }
    const run = (level: string[], nodeStates: Record<string, NodeExecutionState>) =>
      [...computeEmptyInputSkipIds({ level: graph.filter((n) => level.includes(n.id)), nodes: graph, edges: wires, nodeStates, deadIds: new Set() })]

    it("a webhook whose only wire is a filter that kept no row is skipped — no empty POST", () => {
      expect(run(["hook"], { siteOnly: emptyList })).toEqual(["hook"])
    })

    it("the same webhook posts when the filter kept rows (a fan-out) or one row", () => {
      expect(run(["hook"], { siteOnly: { status: "completed", output: { text: "{\"a\":1}", listResults: ["{\"a\":1}", "{\"a\":2}"] } } })).toEqual([])
      expect(run(["hook"], { siteOnly: { status: "completed", output: { text: "{\"a\":1}", listResults: ["{\"a\":1}"] } } })).toEqual([])
    })

    it("a social post with nothing on ANY wire is skipped; a picture alone still posts", () => {
      expect(run(["tg"], { posts: emptyList, pics: { status: "skipped" } })).toEqual(["tg"])
      expect(run(["tg"], { posts: emptyList, pics: { status: "completed", output: { imageUrl: "https://cdn.example.test/a.png" } } })).toEqual([])
    })

    it("a typed caption with no wire is the author's choice — never evaluated", () => {
      expect(run(["typedTg"], {})).toEqual([])
    })

    it("a saved-data seed on the wire is not 'nothing this run'", () => {
      expect(run(["hook"], { siteOnly: { ...emptyList, fromSavedData: true } })).toEqual([])
    })
  })

  it("skips a writer whose wired text came from nodes that produced nothing in this run", () => {
    const nodeStates = { feed: completed(""), feed2: completed(""), combine: completed("") }
    const skipped = computeEmptyInputSkipIds({ level: level("llm"), nodes, edges, nodeStates, deadIds: new Set() })
    expect([...skipped]).toEqual(["llm"])
  })

  it("a Read Collection whose window held nothing starves the writer behind it — the news template's dedupe path ends 'nothing new'", () => {
    const graph: SimpleNode[] = [node("reader", "collection-read", { collectionId: "c1", windowAmount: 48, windowUnit: "hours" }), node("writer", "llm-chat")]
    const wires: SimpleEdge[] = [edge("reader", "writer", "text", "prompt")]
    const idle = computeEmptyInputSkipIds({ level: [graph[1]!], nodes: graph, edges: wires, nodeStates: { reader: completed("") }, deadIds: new Set() })
    expect([...idle]).toEqual(["writer"])
    const busy = computeEmptyInputSkipIds({ level: [graph[1]!], nodes: graph, edges: wires, nodeStates: { reader: completed("- Story r1 · 2026-10-06") }, deadIds: new Set() })
    expect(busy.size).toBe(0)
  })

  it("a Read Inspiration / Read Competitor whose period held nothing starves the writer behind it", () => {
    for (const type of ["inspiration-read", "competitor-read"]) {
      const graph: SimpleNode[] = [node("reader", type, { period: "window", windowAmount: 1, windowUnit: "days" }), node("writer", "llm-chat")]
      const wires: SimpleEdge[] = [edge("reader", "writer", "text", "prompt")]
      const idle = computeEmptyInputSkipIds({ level: [graph[1]!], nodes: graph, edges: wires, nodeStates: { reader: completed("") }, deadIds: new Set() })
      expect([...idle]).toEqual(["writer"])
      const busy = computeEmptyInputSkipIds({ level: [graph[1]!], nodes: graph, edges: wires, nodeStates: { reader: completed("post p1") }, deadIds: new Set() })
      expect(busy.size).toBe(0)
    }
  })

  it("a Save to Collection straight after a feed with nothing new is skipped — a typed title or link keeps it running", () => {
    const graph: SimpleNode[] = [node("feed", "telegram-channel-feed", { channel: "acme" }), node("save", "collection-write", { collectionId: "c1" })]
    const wires: SimpleEdge[] = [edge("feed", "save", "text", "in")]
    const idle = computeEmptyInputSkipIds({ level: [graph[1]!], nodes: graph, edges: wires, nodeStates: { feed: completed("") }, deadIds: new Set() })
    expect([...idle]).toEqual(["save"])
    const typed: SimpleNode[] = [graph[0]!, node("save", "collection-write", { collectionId: "c1", link: "https://news.example.test/daily" })]
    expect(computeEmptyInputSkipIds({ level: [typed[1]!], nodes: typed, edges: wires, nodeStates: { feed: completed("") }, deadIds: new Set() }).size).toBe(0)
    expect(computeEmptyInputSkipIds({ level: [graph[1]!], nodes: graph, edges: wires, nodeStates: { feed: completed("post 1") }, deadIds: new Set() }).size).toBe(0)
  })

  it("a Generate Image whose prompt source produced nothing is skipped even while a picker keeps a wire live — no paid picture of nothing", () => {
    const graph: SimpleNode[] = [
      node("writer", "llm-chat"),
      node("look", "setting", { setting: "neon-city" }),
      node("cover", "generate-image", { prompt: "" }),
    ]
    const wires: SimpleEdge[] = [edge("writer", "cover", "text", "prompt"), edge("look", "cover", "out", "look")]
    const states: Record<string, NodeExecutionState> = { writer: { status: "skipped" }, look: seeded("neon city") }
    expect([...computeEmptyInputSkipIds({ level: [graph[2]!], nodes: graph, edges: wires, nodeStates: states, deadIds: new Set() })]).toEqual(["cover"])
    // A typed prompt is a request of its own: the picture is made.
    const typed: SimpleNode[] = [graph[0]!, graph[1]!, node("cover", "generate-image", { prompt: "a city at dusk" })]
    expect(computeEmptyInputSkipIds({ level: [typed[2]!], nodes: typed, edges: wires, nodeStates: states, deadIds: new Set() }).size).toBe(0)
    // Nothing wired into the prompt at all (references only): not this rule's business.
    const refsOnly: SimpleEdge[] = [edge("look", "cover", "out", "look")]
    expect(computeEmptyInputSkipIds({ level: [graph[2]!], nodes: graph, edges: refsOnly, nodeStates: states, deadIds: new Set() }).size).toBe(0)
  })

  it("a typed prompt still runs on an empty wire; a node with no wire at all is left to fail loudly", () => {
    const nodeStates = { feed: completed(""), feed2: completed(""), combine: completed("") }
    const skipped = computeEmptyInputSkipIds({ level: level("typed", "lonely"), nodes, edges, nodeStates, deadIds: new Set() })
    expect(skipped.size).toBe(0)
  })

  it("a saved-data seed that is empty is not 'nothing new' — stale saved results never make a run read as idle", () => {
    const nodeStates = { feed: seeded(""), feed2: seeded(""), combine: seeded("") }
    const skipped = computeEmptyInputSkipIds({ level: level("llm"), nodes, edges, nodeStates, deadIds: new Set() })
    expect(skipped.size).toBe(0)
  })

  it("one feed with news is enough: the writer runs", () => {
    const nodeStates = { feed: completed(""), feed2: completed("Big launch"), combine: completed("Big launch") }
    const skipped = computeEmptyInputSkipIds({ level: level("llm"), nodes, edges, nodeStates, deadIds: new Set() })
    expect(skipped.size).toBe(0)
  })

  it("an image node whose prompt source produced nothing this run is skipped too — a paid picture of nothing is not a legal request", () => {
    // (Decided 2026-10-06 after the series review; the typed-prompt and references-only cases live in the Generate Image test above.)
    const nodeStates = { feed: completed(""), feed2: completed(""), combine: completed("") }
    const skipped = computeEmptyInputSkipIds({ level: level("gen"), nodes, edges, nodeStates, deadIds: new Set() })
    expect([...skipped]).toEqual(["gen"])
  })

  it("a node behind a gated or run-time skipped source is starved too; a node already dead is not re-judged", () => {
    const nodeStates: Record<string, NodeExecutionState> = {
      feed: completed(""),
      feed2: completed(""),
      combine: completed(""),
      llm: { status: "skipped", skipReason: "empty_input" },
    }
    const skipped = computeEmptyInputSkipIds({ level: level("tts", "llm"), nodes, edges, nodeStates, deadIds: new Set(["llm"]) })
    expect([...skipped]).toEqual(["tts"])
  })

  it("a fan-out is never evaluated — its items are non-empty by construction", () => {
    const nodeStates: Record<string, NodeExecutionState> = {
      split: { status: "completed", output: { text: "a\nb", listResults: ["a", "b"] } },
    }
    const skipped = computeEmptyInputSkipIds({ level: level("fan"), nodes, edges, nodeStates, deadIds: new Set() })
    expect(skipped.size).toBe(0)
  })
})

describe("computeGatedIds — the router gate generalized to run-time skipped sources", () => {
  const chain: SimpleNode[] = [node("router", "router"), node("a", "llm-chat"), node("b", "text-to-speech"), node("c", "generate-image"), node("d", "combine-text")]
  const chainEdges: SimpleEdge[] = [
    edge("router", "a", "yes", "prompt"),
    edge("a", "b"),
    edge("a", "c"),
    edge("d", "c", "text", "prompt"),
  ]

  it("an inactive route gates the nodes behind it — reason router — and the gate cascades", () => {
    const nodeStates: Record<string, NodeExecutionState> = {
      router: { status: "completed", output: { routeOutputs: { yes: undefined, no: "x" } } },
      d: { status: "skipped" },
    }
    const gated = computeGatedIds(chain, chainEdges, nodeStates)
    expect(gated.get("a")).toBe("router")
    expect(gated.get("b")).toBe("router")
    // c has one dead parent (a) and one dead parent (d, a reason-less run-time skip): gated, by the router.
    expect(gated.get("c")).toBe("router")
  })

  it("a node the run skipped for want of input starves its dependents with the SAME reason", () => {
    const nodeStates: Record<string, NodeExecutionState> = {
      a: { status: "skipped", skipReason: "empty_input" },
      d: { status: "completed", output: { text: "x" } },
    }
    const gated = computeGatedIds(chain, chainEdges, nodeStates)
    expect(gated.get("b")).toBe("empty_input")
    // c still has a live parent (d): not gated.
    expect(gated.has("c")).toBe(false)
    // The dead source itself is already skipped — the callers want the newly gated nodes.
    expect(gated.has("a")).toBe(false)
  })

  it("a frozen node (Skip, a saved-data seed) is a seed, not a dead source", () => {
    const nodeStates: Record<string, NodeExecutionState> = { a: { status: "skipped", fromSavedData: true } }
    expect(computeGatedIds(chain, chainEdges, nodeStates).size).toBe(0)
  })

  it("nothing dead, nothing gated", () => {
    expect(computeGatedIds(chain, chainEdges, {}).size).toBe(0)
  })
})
