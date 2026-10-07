import { describe, it, expect } from "vitest"
import { describeEdgeAdjustments, normalizeWorkflowEdges } from "../workflow-edge-normalization.js"

/**
 * The normalizer every server-side workflow write runs its edges through.
 * It rewires only what the editor's own load-time pass would (a recorded
 * alias, the source-type classifiers that follow it, Generate Image's
 * migration, llm-chat's legacy `in`, a declared-only id onto the pip that
 * draws), gives an id to an edge without one, warns about a handle the node
 * does not declare WITHOUT touching it, drops a broken edge with a warning,
 * and refuses only a duplicate id. Idempotent: its own output normalizes to
 * itself.
 */
const nodes = [
  { id: "feed", type: "telegram-channel-feed" },
  { id: "combine", type: "combine-text" },
  { id: "llm", type: "llm-chat" },
  { id: "img", type: "upload-image" },
  { id: "gen", type: "generate-image" },
  { id: "prompt", type: "text-prompt" },
  { id: "list", type: "list" },
  { id: "tg", type: "telegram-trigger" },
  { id: "odd", type: "not-a-real-type" },
  { id: "mt", type: "motion-transfer" },
  { id: "vid", type: "upload-video" },
  { id: "char", type: "character" },
  { id: "v2v", type: "video-to-video" },
  { id: "vc", type: "voice-changer" },
  { id: "dub", type: "dubbing" },
  { id: "tts", type: "text-to-speech" },
  { id: "voice", type: "suno-voice" },
  { id: "suno", type: "suno-generate" },
  { id: "cover", type: "suno-cover" },
  { id: "trim", type: "trim-video" },
  { id: "merge", type: "merge-video-audio" },
  { id: "stems", type: "audio-separation" },
  { id: "store", type: "save-to-storage" },
  { id: "yt", type: "youtube-video" },
  { id: "fx", type: "audio-fx" },
  { id: "fs", type: "face-swap" },
]

const clean = <R extends { readonly warnings: string[]; readonly dropped: string[]; readonly errors: string[] }>(r: R): R => {
  expect(r.warnings).toEqual([])
  expect(r.dropped).toEqual([])
  expect(r.errors).toEqual([])
  return r
}

describe("normalizeWorkflowEdges — legacy names", () => {
  it("rewires a recorded legacy handle on either side, reports it, and leaves every other field alone", () => {
    const r = clean(
      normalizeWorkflowEdges(nodes, [
        { id: "e1", source: "feed", sourceHandle: "out", target: "combine", targetHandle: "in", type: "default", animated: true },
      ]),
    )
    expect(r.edges).toEqual([
      { id: "e1", source: "feed", sourceHandle: "text", target: "combine", targetHandle: "text", type: "default", animated: true },
    ])
    expect(r.adjustments).toEqual([
      { edgeId: "e1", field: "sourceHandle", from: "out", to: "text", reason: "alias" },
      { edgeId: "e1", field: "targetHandle", from: "in", to: "text", reason: "alias" },
    ])
  })

  it("the Telegram Trigger's documented-but-never-rendered outputs all land on its one pip", () => {
    const r = clean(normalizeWorkflowEdges(nodes, [{ id: "e1", source: "tg", sourceHandle: "imageUrl", target: "combine", targetHandle: "text" }]))
    expect(r.edges[0]!.sourceHandle).toBe("out")
    expect(r.adjustments).toEqual([{ edgeId: "e1", field: "sourceHandle", from: "imageUrl", to: "out", reason: "alias" }])
  })

  it("llm-chat's legacy `in` goes to prompt for text, to references for an image", () => {
    const r = clean(
      normalizeWorkflowEdges(nodes, [
        { id: "a", source: "prompt", sourceHandle: "prompt", target: "llm", targetHandle: "in" },
        { id: "b", source: "img", sourceHandle: "image", target: "llm", targetHandle: "in" },
      ]),
    )
    expect(r.edges.map((e) => e.targetHandle)).toEqual(["prompt", "references"])
    expect(r.adjustments.map((a) => a.reason)).toEqual(["classified", "classified"])
  })

  it("Generate Image's own migration runs and is recorded: a legacy `in` and a missing handle both classify by source", () => {
    const r = clean(
      normalizeWorkflowEdges(nodes, [
        { id: "a", source: "prompt", sourceHandle: "prompt", target: "gen", targetHandle: "in" },
        { id: "b", source: "img", sourceHandle: "image", target: "gen" },
      ]),
    )
    expect(r.edges.map((e) => e.targetHandle)).toEqual(["prompt", "references"])
    expect(r.adjustments).toEqual([
      { edgeId: "a", field: "targetHandle", from: "in", to: "prompt", reason: "generate-image" },
      { edgeId: "b", field: "targetHandle", from: null, to: "references", reason: "generate-image" },
    ])
  })
})

describe("normalizeWorkflowEdges — the classifiers that follow the table (the editor's load-time rules)", () => {
  it("motion-transfer's legacy `in`: an image → image, an entity → assets, a text → prompt, a video → video", () => {
    const r = clean(
      normalizeWorkflowEdges(nodes, [
        { id: "a", source: "img", sourceHandle: "image", target: "mt", targetHandle: "in" },
        { id: "b", source: "char", sourceHandle: "image", target: "mt", targetHandle: "in" },
        { id: "c", source: "prompt", sourceHandle: "prompt", target: "mt", targetHandle: "in" },
        { id: "d", source: "vid", sourceHandle: "video", target: "mt", targetHandle: "in" },
      ]),
    )
    expect(r.edges.map((e) => e.targetHandle)).toEqual(["image", "assets", "prompt", "video"])
    // The table's choice (`video`) is recorded, then the classifier's.
    expect(r.adjustments.filter((a) => a.edgeId === "a").map((a) => `${a.from}→${a.to}:${a.reason}`)).toEqual(["in→video:alias", "video→image:classified"])
    expect(r.adjustments.filter((a) => a.edgeId === "d").map((a) => `${a.from}→${a.to}:${a.reason}`)).toEqual(["in→video:alias"])
  })

  it("video-to-video's `in` from a text node is its prompt; from a video it is the video", () => {
    const r = clean(
      normalizeWorkflowEdges(nodes, [
        { id: "a", source: "prompt", sourceHandle: "prompt", target: "v2v", targetHandle: "in" },
        { id: "b", source: "vid", sourceHandle: "video", target: "v2v", targetHandle: "in" },
      ]),
    )
    expect(r.edges.map((e) => e.targetHandle)).toEqual(["prompt", "video"])
  })

  it("a dual-mode revoice node's `in` is the lane the source is: a video keeps video mode, audio goes to audio", () => {
    const r = clean(
      normalizeWorkflowEdges(nodes, [
        { id: "a", source: "vid", sourceHandle: "video", target: "vc", targetHandle: "in" },
        { id: "b", source: "tts", sourceHandle: "audio", target: "vc", targetHandle: "in" },
        { id: "c", source: "vid", sourceHandle: "video", target: "dub" },
        { id: "d", source: "vid", sourceHandle: "video", target: "vc", targetHandle: "audio" },
      ]),
    )
    // An explicit `audio` wire is the person's choice and stays.
    expect(r.edges.map((e) => e.targetHandle)).toEqual(["video", "audio", "video", "audio"])
  })

  it("the video and audio sources are the shared producer sets, never a frozen copy: youtube-video, face-swap and audio-fx classify by what they emit; a dynamic producer is left as the table had it", () => {
    const r = clean(
      normalizeWorkflowEdges(nodes, [
        // A video producer the editor's old literal list did not know.
        { id: "a", source: "yt", sourceHandle: "video", target: "vc", targetHandle: "in" },
        // face-swap's one output is a video — never motion-transfer's image lane.
        { id: "b", source: "fs", sourceHandle: "video", target: "mt", targetHandle: "in" },
        // An audio producer the old literal list did not know.
        { id: "c", source: "fx", sourceHandle: "audio-out", target: "cover", targetHandle: "in" },
        // A list's lane is unknown until run time: the table's `audio` on a revoice node, `prompt` on motion-transfer, as before.
        { id: "d", source: "list", sourceHandle: "col_1", target: "vc", targetHandle: "in" },
        { id: "e", source: "list", sourceHandle: "col_1", target: "mt", targetHandle: "in" },
      ]),
    )
    expect(r.edges.map((e) => e.targetHandle)).toEqual(["video", "video", "audio", "audio", "prompt"])
  })

  it("suno-voice into a Suno node with a voice handle lands on `voice`; a Suno continuation node's `in` is audio or prompt by source", () => {
    const r = clean(
      normalizeWorkflowEdges(nodes, [
        { id: "a", source: "voice", sourceHandle: "voicePersona", target: "suno", targetHandle: "in" },
        { id: "b", source: "tts", sourceHandle: "audio", target: "cover", targetHandle: "in" },
        { id: "c", source: "prompt", sourceHandle: "prompt", target: "cover", targetHandle: "in" },
      ]),
    )
    expect(r.edges.map((e) => e.targetHandle)).toEqual(["voice", "audio", "prompt"])
  })
})

describe("normalizeWorkflowEdges — the #1877 burn-down: definitions declare the pips their components render", () => {
  it("the rendered pip is the declared output and is kept; the id a definition used to declare moves onto it as an alias", () => {
    const r = clean(
      normalizeWorkflowEdges(nodes, [
        { id: "a", source: "trim", sourceHandle: "video-out", target: "merge", targetHandle: "in" },
        { id: "b", source: "merge", sourceHandle: "video", target: "trim", targetHandle: "in" },
        { id: "c", source: "store", sourceHandle: "asset", target: "combine", targetHandle: "text" },
        { id: "d", source: "stems", sourceHandle: "vocals", target: "vc", targetHandle: "audio" },
      ]),
    )
    expect(r.edges.map((e) => e.sourceHandle)).toEqual(["video-out", "video-out", "out", "vocals"])
    expect(r.adjustments).toEqual([
      { edgeId: "b", field: "sourceHandle", from: "video", to: "video-out", reason: "alias" },
      { edgeId: "c", field: "sourceHandle", from: "asset", to: "out", reason: "alias" },
    ])
  })

  it("audio-separation's old `audio` id is kept and warned about — it could mean any stem, and a stem is never guessed", () => {
    const r = normalizeWorkflowEdges(nodes, [{ id: "a", source: "stems", sourceHandle: "audio", target: "vc", targetHandle: "audio" }])
    expect(r.adjustments).toEqual([])
    expect(r.edges[0]!.sourceHandle).toBe("audio")
    expect(r.warnings[0]).toContain('"audio" is not an output of audio-separation (outputs: vocals, instrumental, drums, bass, guitar, piano, other)')
  })
})

describe("normalizeWorkflowEdges — ids", () => {
  it("an edge without an id gets one from its endpoints AS STORED; the same connection sent again without an id is one wire, kept once; a given id is never touched", () => {
    const r = normalizeWorkflowEdges(nodes, [
      { source: "feed", sourceHandle: "out", target: "llm", targetHandle: "in" },
      // The same wire in the stored spelling — a repeat, not a second edge.
      { source: "feed", sourceHandle: "text", target: "llm", targetHandle: "prompt" },
      { id: "mine", source: "prompt", target: "combine" },
    ])
    expect(r.edges.map((e) => e.id)).toEqual(["e-feed-text-llm-prompt", "mine"])
    expect(r.dropped).toEqual(['edge "feed→llm": the same connection as edge "e-feed-text-llm-prompt", sent again without an id — dropped'])
    expect(r.warnings).toEqual([])
    expect(r.errors).toEqual([])
    expect(r.adjustments.filter((a) => a.field === "id")).toEqual([
      { edgeId: "e-feed-text-llm-prompt", field: "id", from: null, to: "e-feed-text-llm-prompt", reason: "generated" },
    ])
  })

  it("two ids for one connection are the client's choice — both kept", () => {
    const r = clean(
      normalizeWorkflowEdges(nodes, [
        { id: "one", source: "prompt", sourceHandle: "prompt", target: "combine", targetHandle: "text" },
        { id: "two", source: "prompt", sourceHandle: "prompt", target: "combine", targetHandle: "text" },
      ]),
    )
    expect(r.edges.map((e) => e.id)).toEqual(["one", "two"])
  })

  it("a generated id never collides with one the client gave, nor with a reserved one (the stored edges a delta leaves alone)", () => {
    const given = clean(
      normalizeWorkflowEdges(nodes, [
        // An unrelated edge wearing the id the next one would be given.
        { id: "e-prompt-prompt-combine-text", source: "img", sourceHandle: "image", target: "gen", targetHandle: "references" },
        { source: "prompt", sourceHandle: "prompt", target: "combine", targetHandle: "text" },
      ]),
    )
    expect(given.edges[1]!.id).toBe("e-prompt-prompt-combine-text-2")
    const reserved = clean(
      normalizeWorkflowEdges(nodes, [{ source: "prompt", sourceHandle: "prompt", target: "combine", targetHandle: "text" }], {
        reservedIds: ["e-prompt-prompt-combine-text"],
      }),
    )
    expect((reserved.edges[0] as { id?: string }).id).toBe("e-prompt-prompt-combine-text-2")
  })

  it("is idempotent: its own output normalizes to itself with nothing to report", () => {
    const first = normalizeWorkflowEdges(nodes, [
      { source: "feed", sourceHandle: "out", target: "llm", targetHandle: "in" },
      { id: "b", source: "img", sourceHandle: "image", target: "gen" },
      { id: "c", source: "img", sourceHandle: "image", target: "mt", targetHandle: "in" },
      { id: "d", source: "merge", sourceHandle: "video", target: "trim", targetHandle: "in" },
    ])
    const second = clean(normalizeWorkflowEdges(nodes, first.edges))
    expect(second.edges).toEqual(first.edges)
    expect(second.adjustments).toEqual([])
  })
})

describe("normalizeWorkflowEdges — what it leaves alone", () => {
  it("a handle the node does not declare is kept AS SENT and warned about — never coerced to the node's only handle", () => {
    const r = normalizeWorkflowEdges(nodes, [
      { id: "e1", source: "llm", sourceHandle: "output", target: "combine", targetHandle: "text" },
      { id: "e2", source: "prompt", sourceHandle: "prompt", target: "combine", targetHandle: "words" },
    ])
    expect(r.errors).toEqual([])
    expect(r.dropped).toEqual([])
    expect(r.adjustments).toEqual([])
    expect(r.edges[0]!.sourceHandle).toBe("output")
    expect(r.edges[1]!.targetHandle).toBe("words")
    expect(r.warnings).toHaveLength(2)
    expect(r.warnings[0]).toContain('edge "e1": "output" is not an output of llm-chat')
    expect(r.warnings[0]).toContain("stored as sent")
    expect(r.warnings[1]).toContain('"words" is not an input of combine-text (inputs: text)')
  })

  it("does not judge a dynamic-handle node, an unknown node type, or an absent handle", () => {
    const r = clean(
      normalizeWorkflowEdges(nodes, [
        { id: "a", source: "list", sourceHandle: "col_abc", target: "combine", targetHandle: "text" },
        { id: "b", source: "odd", sourceHandle: "anything", target: "combine", targetHandle: "text" },
        { id: "c", source: "prompt", target: "combine" },
      ]),
    )
    expect(r.adjustments).toEqual([])
    expect(r.edges[1]!.sourceHandle).toBe("anything")
    expect(r.edges[2]).toEqual({ id: "c", source: "prompt", target: "combine" })
  })
})

describe("normalizeWorkflowEdges — the structurally broken", () => {
  it("drops a dangling endpoint, a self-loop, a missing endpoint and a non-object with a warning each; a duplicate id is the one error", () => {
    const r = normalizeWorkflowEdges(nodes, [
      { id: "ok", source: "prompt", sourceHandle: "prompt", target: "combine", targetHandle: "text" },
      { id: "dangling", source: "ghost", target: "combine" },
      { id: "loop", source: "llm", target: "llm" },
      { id: "ok", source: "img", sourceHandle: "image", target: "gen", targetHandle: "references" },
      { source: "prompt" },
      "not an edge" as unknown as { id: string },
    ])
    expect(r.errors).toEqual(['edge "ok": duplicate edge id'])
    expect(r.dropped).toEqual([
      'edge "dangling": source node "ghost" does not exist — dropped',
      'edge "loop": an edge cannot connect a node to itself — dropped',
      'edge "prompt→?": both source and target are required — dropped',
      "an edge that is not an object was dropped",
    ])
    expect(r.edges.map((e) => e.id)).toEqual(["ok"])
  })
})

describe("describeEdgeAdjustments", () => {
  it("one readable line per change, naming the edge as stored", () => {
    const r = normalizeWorkflowEdges(nodes, [{ source: "feed", sourceHandle: "out", target: "llm", targetHandle: "in" }])
    expect(describeEdgeAdjustments(r.adjustments)).toEqual([
      'edge e-feed-text-llm-prompt: sourceHandle "out" → "text" (a legacy name for this handle)',
      'edge e-feed-text-llm-prompt: targetHandle "in" → "prompt" (chosen from the other node\'s type)',
      'edge e-feed-text-llm-prompt: had no id — given "e-feed-text-llm-prompt"',
    ])
  })
})
