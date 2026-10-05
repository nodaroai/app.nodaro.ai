// "Clear results" takes the canvas back to "never ran": every run result goes,
// nothing a person put on the canvas does. These tests pin both halves — the
// second is the one that costs someone their work when it slips.
import { describe, it, expect } from "vitest"
import { COMPOSER_PLAN_FIELDS, EXECUTION_DATA_KEYS, stripExportContent } from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { AUTO_EXECUTE_IGNORE_KEYS } from "@/hooks/use-auto-execute"
import {
  RUN_RESULT_EXTRA_KEYS,
  RUN_RESULT_KEEP_KEYS,
  RUN_RESULT_TYPE_KEYS,
  clearRunResults,
  clearScopeOf,
  clearedConnectedListRows,
  hasRunResults,
  isRunInProgress,
} from "../clear-run-results"

function node(id: string, type: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data }, ...extra } as unknown as WorkflowNode
}
function edge(source: string, target: string, sourceHandle?: string, targetHandle?: string): WorkflowEdge {
  return { id: `${source}-${target}`, source, target, sourceHandle, targetHandle } as unknown as WorkflowEdge
}
const CLEARED_AT = "2026-09-20T10:00:00.000Z"
const clear = (nodes: WorkflowNode[], edges: WorkflowEdge[]) => clearRunResults(nodes, edges, CLEARED_AT)

/** Node data WITHOUT the clear's own stamp — most tests care what was kept and what went. */
const dataOf = (n: WorkflowNode | undefined) => {
  const { resultsClearedAt: _stamp, ...rest } = (n?.data ?? {}) as Record<string, unknown>
  return rest
}
const stampOf = (n: WorkflowNode | undefined) => (n?.data as Record<string, unknown> | undefined)?.resultsClearedAt
const byId = (nodes: readonly WorkflowNode[], id: string) => nodes.find((n) => n.id === id)

const RESULT = { url: "https://cdn.test/a.png", jobId: "j1", timestamp: "2026-09-20T00:00:00Z" }

describe("what a run left behind is removed", () => {
  it("a generator loses its media, its history, its status and its error — and keeps every setting", () => {
    const image = node("img", "generate-image", {
      prompt: "a red fox",
      provider: "gpt-image-2",
      aspectRatio: "3:4",
      fieldMappings: { prompt: "txt" },
      generatedImageUrl: RESULT.url,
      generatedResults: [RESULT],
      activeResultIndex: 2,
      executionStatus: "failed",
      errorMessage: "provider said no",
      errorHint: { kind: "policy-block" },
      currentJobId: "j1",
      currentJobProgress: 40,
      kieTaskId: "task-9",
      thumbnailUrl: "https://cdn.test/t.jpg",
      contentPolicyRewrites: ["x"],
    })
    const out = clear([image], [])
    expect(out?.clearedCount).toBe(1)
    expect(dataOf(out?.nodes[0])).toEqual({
      label: "img",
      prompt: "a red fox",
      provider: "gpt-image-2",
      aspectRatio: "3:4",
      fieldMappings: { prompt: "txt" },
    })
  })

  it("text, list and selector outputs go too", () => {
    const chat = node("llm", "llm-chat", {
      systemPrompt: "be brief",
      generatedText: "hello",
      generatedItems: ["a", "b"],
      generatedJson: { a: 1 },
      lastSystemPrompt: "be brief",
      lastUserPrompt: "hi",
      __listResults: ["a", "b"],
      __alignedListResults: ["a", "b"],
      __listTotal: 2,
      __listCompleted: 2,
      listResults: ["a", "b"],
      __listInputs: ["x"],
    })
    const selector = node("sel", "selector", {
      mode: "first",
      pickedResults: ["a"],
      restResults: ["b"],
      __pickedResults: ["a"],
      __restResults: ["b"],
      __pickedTotal: 1,
      __restTotal: 1,
    })
    const out = clear([chat, selector], [])
    expect(dataOf(byId(out!.nodes, "llm"))).toEqual({ label: "llm", systemPrompt: "be brief" })
    expect(dataOf(byId(out!.nodes, "sel"))).toEqual({ label: "sel", mode: "first" })
  })

  it("a key the node type declares a default for goes back to that default, not to nothing", () => {
    // ~40 node types ship `executionStatus: "idle", generatedResults: [],
    // activeResultIndex: 0` as their defaults and read them without a guard —
    // a cleared node has to look like a NEW one, not like one missing fields.
    const lipSync = node("ls", "lip-sync", {
      provider: "kling-lip-sync",
      generatedVideoUrl: "https://cdn.test/v.mp4",
      generatedResults: [RESULT],
      activeResultIndex: 1,
      executionStatus: "completed",
      audioDurationSec: 12,
    })
    const data = dataOf(clear([lipSync], [])?.nodes[0])
    expect(data.generatedResults).toEqual([])
    expect(data.activeResultIndex).toBe(0)
    expect(data.executionStatus).toBe("idle")
    expect("generatedVideoUrl" in data).toBe(false)
    // A probe of the INPUT audio, cached on the node — not an output.
    expect(data.audioDurationSec).toBe(12)
    expect(data.provider).toBe("kling-lip-sync")
  })

  it("never hands two nodes the node definition's OWN default array", () => {
    const a = node("a", "lip-sync", { generatedResults: [RESULT], generatedVideoUrl: "v" })
    const b = node("b", "lip-sync", { generatedResults: [RESULT], generatedVideoUrl: "v" })
    const out = clear([a, b], [])
    const [first, second] = out!.nodes.map((n) => (n.data as Record<string, unknown>).generatedResults)
    expect(first).toEqual([])
    expect(first).not.toBe(second)
  })

  it("generic result names are cleared only on the node types that own them", () => {
    const qa = node("qa", "qa-check", { threshold: 0.7, score: 0.2, approved: false, reason: "blurry", executionStatus: "completed" })
    const critic = node("cr", "image-critic", { threshold: 0.7, score: 0.9, approved: true, feedback: "ok", details: { a: 1 } })
    // `approved` / `details` / `feedback` mean something else on a script node.
    const script = node("gs", "generate-script", { approved: true, details: "keep", feedback: "keep", score: 3 })
    const out = clear([qa, critic, script], [])
    expect(dataOf(byId(out!.nodes, "qa"))).toEqual({ label: "qa", threshold: 0.7 })
    expect(dataOf(byId(out!.nodes, "cr"))).toEqual({ label: "cr", threshold: 0.7 })
    expect(byId(out!.nodes, "gs")).toBe(script)
  })

  it("every stem of a separation goes — each is its own output handle, and one left behind feeds the next run", () => {
    const stems = node("sep", "audio-separation", {
      mode: "stems",
      generatedAudioUrl: "https://cdn.test/mix.mp3",
      vocalUrl: "v",
      instrumentalUrl: "i",
      drumsUrl: "d",
      bassUrl: "b",
      otherUrl: "o",
      guitarUrl: "g",
      pianoUrl: "p",
    })
    const suno = node("ss", "suno-separate", { stems: [{ name: "drums", url: "d" }], vocalUrl: "v" })
    const out = clear([stems, suno], [])
    expect(dataOf(byId(out!.nodes, "sep"))).toEqual({ label: "sep", mode: "stems" })
    expect(dataOf(byId(out!.nodes, "ss"))).toEqual({ label: "ss" })
  })

  it("outputs that reach the node through a poll callback go too — overlay renders, the silent cut, a run's warning, a slideshow's disclosure, a scraper's ledger", () => {
    const overlay = node("ov", "image-overlay", {
      canvas: { width: 1080, height: 1350, backgroundColor: "#000" },
      platform: "instagram-portrait",
      generatedImageUrl: RESULT.url,
      overlayVariants: [{ id: "story", label: "Story", url: "u", width: 1080, height: 1920 }],
      overlayComposition: "abc",
      width: 1080,
      height: 1350,
    })
    const trim = node("tr", "trim-video", { startSec: 1, generatedVideoUrl: "v", generatedSilentVideoUrl: "s" })
    const avatar = node("av", "ai-avatar", { script: "hi", generatedVideoUrl: "v", warningMessage: "audio trimmed to 600s" })
    const show = node("sl", "slideshow", { perSlideSec: 3, generatedVideoUrl: "v", lastScaleFactor: 0.8, lastAppliedTransition: "fade", lastSlideCount: 4, lastSilent: true })
    const scrape = node("ws", "web-scrape", {
      query: "foxes",
      featuredIndex: 2,
      viewFormat: "cards",
      generatedJson: { results: [1] },
      lastRunOutcome: "success",
      lastRunStartedAt: 1,
      lastRunFingerprint: "f",
      lastRunAt: 2,
      lastRunCount: 1,
      lastGoodAt: 2,
      lastGoodCount: 1,
      lastAppliedJobId: "j",
    })
    const out = clear([overlay, trim, avatar, show, scrape], [])
    expect(dataOf(byId(out!.nodes, "ov"))).toEqual({
      label: "ov",
      canvas: { width: 1080, height: 1350, backgroundColor: "#000" },
      platform: "instagram-portrait",
    })
    expect(dataOf(byId(out!.nodes, "tr"))).toEqual({ label: "tr", startSec: 1 })
    expect(dataOf(byId(out!.nodes, "av")).warningMessage).toBeUndefined()
    expect(dataOf(byId(out!.nodes, "sl"))).toMatchObject({ label: "sl", perSlideSec: 3 })
    expect(Object.keys(dataOf(byId(out!.nodes, "sl"))).filter((key) => key.startsWith("last"))).toEqual([])
    // What the person chose to LOOK at is theirs.
    expect(dataOf(byId(out!.nodes, "ws"))).toEqual({ label: "ws", query: "foxes", featuredIndex: 2, viewFormat: "cards" })
  })

  it("`width` / `height` are a result only on an Image Overlay — elsewhere they are somebody's setting", () => {
    const resize = node("rs", "resize-video", { width: 1280, height: 720, generatedVideoUrl: "v" })
    expect(dataOf(clear([resize], [])?.nodes[0])).toEqual({ label: "rs", width: 1280, height: 720 })
  })

  it("a Collect's snapshot of the last run goes, though the node never executes", () => {
    const collect = node("co", "collect", { order: ["a"], lastInputs: ["x"], lastMeta: { n: 1 }, __upstreamCount: 3 })
    expect(dataOf(clear([collect], [])?.nodes[0])).toEqual({ label: "co", order: ["a"] })
  })
})

describe("a cleared node is stamped, so the next reload leaves it empty", () => {
  it("stamps every node whose RESULTS went — and nothing else", () => {
    const ran = node("r", "generate-image", { prompt: "p", generatedImageUrl: RESULT.url })
    const fresh = node("f", "generate-image", { prompt: "p" })
    const character = node("ch", "character", { name: "Maya", executionStatus: "failed", errorMessage: "no" })
    const columns = [{ id: "c1", handleId: "col_c1", connectedSourceId: "r" }]
    const list = node("ls", "list", { columns, rows: [["https://cdn.test/1.png"]] })
    const out = clear([ran, fresh, character, list], [])
    expect(stampOf(byId(out!.nodes, "r"))).toBe(CLEARED_AT)
    expect(stampOf(byId(out!.nodes, "f"))).toBeUndefined()
    // A content card keeps its content, so recovery already leaves it alone.
    expect(stampOf(byId(out!.nodes, "ch"))).toBeUndefined()
    expect(stampOf(byId(out!.nodes, "ls"))).toBeUndefined()
  })

  it("a stamp from an earlier clear is not itself a result — it neither enables the button nor counts", () => {
    const stamped = node("r", "generate-image", { prompt: "p", resultsClearedAt: "2026-09-01T00:00:00.000Z" })
    expect(hasRunResults([stamped])).toBe(false)
    expect(clear([stamped], [])).toBeNull()
  })

  it("a second clear moves the stamp forward", () => {
    const again = node("r", "generate-image", { prompt: "p", generatedImageUrl: RESULT.url, resultsClearedAt: "2026-09-01T00:00:00.000Z" })
    expect(stampOf(clear([again], [])?.nodes[0])).toBe(CLEARED_AT)
  })
})

describe("what a person put on the canvas stays", () => {
  it("an upload's history is the person's own files, not a run result", () => {
    const upload = node("up", "upload-image", {
      url: "https://cdn.test/mine.png",
      generatedResults: [RESULT, RESULT],
      activeResultIndex: 1,
      thumbnailUrl: "https://cdn.test/mine-t.png",
    })
    const text = node("tx", "text-prompt", { text: "hello", executionStatus: "completed" })
    const link = node("yt", "youtube-video", { youtubeUrl: "https://youtu.be/x", downloadedVideoUrl: "https://cdn.test/v.mp4", thumbnailUrl: "t" })
    const mask = node("pm", "paint-mask", { maskUrl: "https://cdn.test/m.png", sourceImageUrl: "https://cdn.test/s.png" })
    expect(clear([upload, text, link, mask], [])).toBeNull()
    expect(hasRunResults([upload, text, link, mask])).toBe(false)
  })

  it("an entity or Scene card keeps its content and its trained model — only a run's STATE leaves it", () => {
    const character = node("ch", "character", {
      name: "Maya",
      characterDbId: "db-1",
      sourceImageUrl: "https://cdn.test/maya.png",
      generatedImageUrl: "https://cdn.test/maya-2.png",
      generatedResults: [RESULT],
      activeResultIndex: 1,
      loraReplicateVersion: "v1",
      loraTriggerWord: "MAYA",
      loraTrainingStatus: "succeeded",
      executionStatus: "failed",
      errorMessage: "out of credits",
      currentJobId: "j9",
    })
    const data = dataOf(clear([character], [])?.nodes[0])
    expect(data).toEqual({
      label: "ch",
      name: "Maya",
      characterDbId: "db-1",
      sourceImageUrl: "https://cdn.test/maya.png",
      generatedImageUrl: "https://cdn.test/maya-2.png",
      generatedResults: [RESULT],
      activeResultIndex: 1,
      loraReplicateVersion: "v1",
      loraTriggerWord: "MAYA",
      loraTrainingStatus: "succeeded",
      executionStatus: "idle",
    })
    for (const type of ["face", "object", "creature", "location", "scene", "generate-script"]) {
      expect(clearScopeOf(node("e", type)), type).toBe("run-state")
    }
  })

  it("a Script is a document: rewritten scene by scene in its panel, and no re-run brings those edits back", () => {
    const script = node("gs", "generate-script", {
      topic: "foxes",
      generatedScript: { scenes: [{ visualDescription: "rewritten by hand" }] },
      generatedResults: [{ script: { scenes: [] }, jobId: "j", timestamp: "t" }],
      activeResultIndex: 0,
      executionStatus: "failed",
      errorMessage: "timeout",
    })
    const data = dataOf(clear([script], [])?.nodes[0])
    expect(data.generatedScript).toEqual({ scenes: [{ visualDescription: "rewritten by hand" }] })
    expect(data.generatedResults).toHaveLength(1)
    expect(data.errorMessage).toBeUndefined()
  })

  it("a Scene card's VIDEO half has a status of its own — its failure is a leftover too", () => {
    const scene = node("sc", "scene", { description: "harbour", generated_clips: [{ url: "c" }], videoExecutionStatus: "failed" })
    const data = dataOf(clear([scene], [])?.nodes[0])
    expect(data.videoExecutionStatus).toBeUndefined()
    expect(data.generated_clips).toEqual([{ url: "c" }])
    // …while a video half that simply finished is a card with content, like the stills.
    expect(hasRunResults([node("ok", "scene", { videoExecutionStatus: "completed" })])).toBe(false)
  })

  it("a content card that simply FINISHED is not a leftover — there is nothing to clear on it", () => {
    const done = node("ch", "character", { name: "Maya", sourceImageUrl: "https://cdn.test/maya.png", executionStatus: "completed" })
    expect(hasRunResults([done])).toBe(false)
    expect(clear([done], [])).toBeNull()
    // …while the same status on a generator is a run's mark, and goes.
    expect(hasRunResults([node("img", "generate-image", { executionStatus: "completed" })])).toBe(true)
  })

  it("config that is FILED as runtime survives: the Kling storyboard, the node's zoom", () => {
    const video = node("vid", "generate-video", {
      prompt: "p",
      multiShot: true,
      shots: [{ prompt: "one", duration: 5 }],
      zoom: 1.5,
      generatedVideoUrl: "https://cdn.test/v.mp4",
    })
    expect(dataOf(clear([video], [])?.nodes[0])).toEqual({
      label: "vid",
      prompt: "p",
      multiShot: true,
      shots: [{ prompt: "one", duration: 5 }],
      zoom: 1.5,
    })
  })

  it("a composer's plan is a document people edit — the render goes, the plan stays", () => {
    const planned = Object.fromEntries(COMPOSER_PLAN_FIELDS.map((field) => [field, { v: field }]))
    const composer = node("vc", "video-composer", {
      ...planned,
      sceneHistory: [{ id: "r1" }],
      sceneJobBaseRevisionId: "r1",
      lottieUrl: "https://cdn.test/a.json",
      generatedVideoUrl: "https://cdn.test/v.mp4",
    })
    const data = dataOf(clear([composer], [])?.nodes[0])
    expect(data.generatedVideoUrl).toBeUndefined()
    for (const field of COMPOSER_PLAN_FIELDS) expect(data[field], field).toEqual({ v: field })
    expect(data.sceneHistory).toEqual([{ id: "r1" }])
    expect(data.sceneJobBaseRevisionId).toBe("r1")
    expect(data.lottieUrl).toBe("https://cdn.test/a.json")
  })

  it("a feed's cursor stays — clearing it would re-emit every old post on the next scheduled run", () => {
    const feed = node("tg", "telegram-channel-feed", { channel: "@x", lastSeenId: 812, generatedItems: ["post"] })
    expect(dataOf(clear([feed], [])?.nodes[0])).toEqual({ label: "tg", channel: "@x", lastSeenId: 812 })
  })

  it("a pipeline-owned node belongs to its pipeline, not to the canvas", () => {
    const owned = node("ps", "generate-image", { pipeline_owned: true, generatedImageUrl: RESULT.url, generatedResults: [RESULT] })
    const entity = node("pe", "generate-image", { pipeline_entity_id: "ent-1", generatedImageUrl: RESULT.url })
    const pipeline = node("gp", "generative-pipeline", { executionStatus: "completed", generatedText: "x" })
    expect(clear([owned, entity, pipeline], [])).toBeNull()
    for (const shielded of [owned, entity, pipeline]) expect(clearScopeOf(shielded), shielded.id).toBe("none")
    // An EMPTY binding is no binding: a default of "" must not shield the node.
    expect(clearScopeOf(node("free", "generate-image", { pipeline_entity_id: "" }))).toBe("results")
  })

  it("untouched nodes keep their identity, and so does the data of a node with nothing to clear", () => {
    const text = node("tx", "text-prompt", { text: "hi" })
    const fresh = node("f", "generate-image", { prompt: "p", generatedResults: [], activeResultIndex: 0, executionStatus: "idle", currentJobProgress: 0 })
    const ran = node("r", "generate-image", { prompt: "p", generatedImageUrl: RESULT.url })
    const out = clear([text, fresh, ran], [])
    expect(out?.clearedCount).toBe(1)
    expect(byId(out!.nodes, "tx")).toBe(text)
    expect(byId(out!.nodes, "f")).toBe(fresh)
    expect(byId(out!.nodes, "r")).not.toBe(ran)
  })

  it("the input is never mutated", () => {
    const ran = node("r", "generate-image", { prompt: "p", generatedImageUrl: RESULT.url, generatedResults: [RESULT] })
    const before = JSON.stringify(ran)
    clear([ran], [])
    expect(JSON.stringify(ran)).toBe(before)
  })
})

describe("a List's connected columns are results; its typed-in columns are not", () => {
  const columns = [
    { id: "c1", handleId: "col_c1", name: "Prompt" },
    { id: "c2", handleId: "col_c2", name: "Image", connectedSourceId: "img" },
  ]

  it("empties only the connected cells", () => {
    const list = node("ls", "list", { columns, rows: [["fox", "https://cdn.test/1.png"], ["owl", "https://cdn.test/2.png"]] })
    const out = clear([list], [])
    expect(dataOf(out?.nodes[0]).rows).toEqual([["fox", ""], ["owl", ""]])
    expect(out?.clearedCount).toBe(1)
    expect(hasRunResults([list])).toBe(true)
  })

  it("collapses to one empty row when every column is connected", () => {
    const all = [{ ...columns[0], connectedSourceId: "txt" }, columns[1]]
    expect(clearedConnectedListRows(node("ls", "list", { columns: all, rows: [["a", "b"], ["c", "d"]] }))).toEqual([["", ""]])
  })

  it("a malformed table reads as 'nothing to clear' — this runs while the canvas renders and must never throw", () => {
    const broken = [
      node("a", "list", { columns: "nope", rows: [["x"]] }),
      node("b", "list", { columns: [null, { connectedSourceId: "img" }], rows: "nope" }),
      node("c", "list", { columns: [{ connectedSourceId: "img" }, {}], rows: [null, ["x", "y"], "junk"] }),
      node("d", "list", {}),
    ]
    expect(() => hasRunResults(broken)).not.toThrow()
    expect(() => clear(broken, [])).not.toThrow()
    // The one well-formed row in "c" still has its connected cell emptied.
    const c = byId(clear(broken, [])!.nodes, "c")
    expect(dataOf(c).rows).toEqual([null, ["", "y"], "junk"])
  })

  it("leaves a fully manual table — and an already-empty connected one — alone", () => {
    const manual = node("m", "list", { columns: [columns[0]], rows: [["fox"], ["owl"]] })
    const empty = node("e", "list", { columns, rows: [["fox", ""], ["owl", ""]] })
    expect(clear([manual, empty], [])).toBeNull()
    expect(hasRunResults([manual, empty])).toBe(false)
  })
})

describe("derived and legacy canvas state follows the clear", () => {
  it("a Preview is recollected from the cleared graph in the same pass", () => {
    const image = node("img", "generate-image", { prompt: "p", generatedImageUrl: RESULT.url, generatedResults: [RESULT] })
    const text = node("tx", "text-prompt", { text: "still here" })
    const preview = node("pv", "preview", {
      previewItems: [
        { type: "image", value: RESULT.url, itemKey: "img:image", sourceNodeId: "img", sourceHandle: "image", sourceNodeLabel: "img", visible: true },
        { type: "text", value: "still here", itemKey: "tx", sourceNodeId: "tx", sourceNodeLabel: "tx", visible: true },
      ],
      itemOrder: ["img:image", "tx"],
    })
    const out = clear([image, text, preview], [edge("img", "pv", "image", "in"), edge("tx", "pv", undefined, "in")])
    const items = dataOf(byId(out!.nodes, "pv")).previewItems as Array<{ sourceNodeId: string }>
    expect(items.map((item) => item.sourceNodeId)).toEqual(["tx"])
    // The Preview followed its upstream; it is not itself reported as cleared.
    expect(out?.clearedCount).toBe(1)
  })

  it("a Preview holding a STALE value is corrected in the same pass — same count, different value", () => {
    // The Preview's stored item says "stale"; its source says "fresh". Comparing
    // by COUNT would call that unchanged and leave the stale value on the card.
    const image = node("img", "generate-image", { prompt: "p", generatedImageUrl: RESULT.url })
    const text = node("tx", "text-prompt", { text: "fresh" })
    const preview = node("pv", "preview", {
      previewItems: [{ type: "text", value: "stale", itemKey: "tx:", sourceNodeId: "tx", sourceNodeLabel: "tx", visible: false }],
      itemOrder: ["tx:"],
    })
    const out = clear([image, text, preview], [edge("tx", "pv", undefined, "in")])
    const items = (dataOf(byId(out!.nodes, "pv")).previewItems ?? []) as Array<{ value: string; visible: boolean }>
    expect(items.map((item) => item.value)).toEqual(["fresh"])
    // The person's show/hide choice for that source survives the recollect.
    expect(items[0].visible).toBe(false)
  })

  it("a Preview fed by ANOTHER Preview settles in the same pass — it reads the first one's items, not its upstream", () => {
    const image = node("img", "generate-image", { prompt: "p", generatedImageUrl: RESULT.url })
    const item = { type: "image", value: RESULT.url, itemKey: "img:image", sourceNodeId: "img", sourceHandle: "image", sourceNodeLabel: "img", visible: true }
    const first = node("p1", "preview", { previewItems: [item], itemOrder: ["img:image"] })
    const second = node("p2", "preview", {
      previewItems: [{ ...item, itemKey: "p1:", sourceNodeId: "p1", sourceHandle: undefined, sourceNodeLabel: "p1" }],
      itemOrder: ["p1:"],
    })
    // p2 is listed BEFORE p1 on purpose: one pass in array order would read p1's stale items.
    const out = clear([image, second, first], [edge("img", "p1", "image", "in"), edge("p1", "p2", undefined, "in")])
    expect(dataOf(byId(out!.nodes, "p1")).previewItems).toEqual([])
    expect(dataOf(byId(out!.nodes, "p2")).previewItems).toEqual([])
  })

  it("the edges array keeps its identity when no clone had to go", () => {
    const edges = [edge("a", "b")]
    const out = clear([node("b", "generate-image", { generatedImageUrl: RESULT.url })], edges)
    expect(out?.edges).toBe(edges)
  })

  it("expanded list clones are results: they go, their edges go, the hidden original comes back", () => {
    const original = node("node_7", "generate-image", { prompt: "p", __listResults: ["a", "b"] }, { hidden: true })
    const cloneA = node("node_7_iter_0", "generate-image", { prompt: "p", generatedImageUrl: "a", __expandedClone: true })
    const cloneB = node("node_7_iter_1", "generate-image", { prompt: "p", generatedImageUrl: "b" })
    const scratch = node("__sub_x", "generate-image", { prompt: "p" }, { hidden: true })
    const text = node("tx", "text-prompt", { text: "hi" })
    const out = clear(
      [original, cloneA, cloneB, scratch, text],
      [edge("tx", "node_7"), edge("tx", "node_7_iter_0"), edge("tx", "node_7_iter_1")],
    )
    expect(out!.nodes.map((n) => n.id)).toEqual(["node_7", "__sub_x", "tx"])
    expect(byId(out!.nodes, "node_7")?.hidden).toBe(false)
    expect(byId(out!.nodes, "__sub_x")?.hidden).toBe(true)
    expect(out!.edges.map((e) => e.id)).toEqual(["tx-node_7"])
    // Only the original lost data; being un-hidden is not "cleared".
    expect(out!.clearedCount).toBe(1)
  })

  it("clones alone are enough to clear — even when no surviving node holds a result", () => {
    const original = node("node_3", "generate-image", { prompt: "p" }, { hidden: true })
    const clone = node("node_3_iter_0", "generate-image", { prompt: "p", generatedImageUrl: "a" })
    const out = clear([original, clone], [])
    expect(out?.nodes.map((n) => n.id)).toEqual(["node_3"])
    expect(out?.nodes[0].hidden).toBe(false)
    expect(out?.clearedCount).toBe(0)
  })

  it("a hidden node is left hidden when there were no clones to collapse", () => {
    const hidden = node("h", "generate-image", { prompt: "p", generatedImageUrl: RESULT.url }, { hidden: true })
    expect(clear([hidden], [])?.nodes[0].hidden).toBe(true)
  })
})

describe("whether there is anything to clear, and whether it is safe to", () => {
  it("hasRunResults agrees with clearRunResults", () => {
    const fresh = node("f", "generate-image", { prompt: "p" })
    const ran = node("r", "generate-image", { prompt: "p", generatedImageUrl: RESULT.url })
    const failed = node("x", "generate-image", { prompt: "p", executionStatus: "failed", errorMessage: "no" })
    expect(hasRunResults([fresh])).toBe(false)
    expect(clear([fresh], [])).toBeNull()
    expect(hasRunResults([fresh, ran])).toBe(true)
    expect(hasRunResults([failed])).toBe(true)
    expect(hasRunResults([node("node_1_iter_0", "generate-image")])).toBe(true)
  })

  it("answers from the node's CURRENT data — the per-object memo never outlives an edit", () => {
    const before = node("r", "generate-image", { prompt: "p", generatedImageUrl: RESULT.url })
    expect(hasRunResults([before])).toBe(true)
    expect(hasRunResults([before])).toBe(true)
    // An edit (or the clear itself) always arrives as a NEW data object.
    const after = { ...before, data: { label: "r", prompt: "p" } } as WorkflowNode
    expect(hasRunResults([after])).toBe(false)
    // Asked twice: the second answer comes from the memo, and must be the same one.
    expect(hasRunResults([after])).toBe(false)
    expect(hasRunResults([before])).toBe(true)
  })

  it("does not re-read a node it has already answered for — a drag re-renders the canvas 60 times a second", () => {
    let reads = 0
    const data = new Proxy({ label: "r", prompt: "p", generatedImageUrl: RESULT.url } as Record<string, unknown>, {
      ownKeys(target) {
        reads++
        return Reflect.ownKeys(target)
      },
    })
    const dragged = { id: "r", type: "generate-image", position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
    expect(hasRunResults([dragged])).toBe(true)
    const afterFirst = reads
    expect(afterFirst).toBeGreaterThan(0)
    // Same data object, new position: what a drag frame looks like.
    expect(hasRunResults([{ ...dragged, position: { x: 5, y: 5 } } as WorkflowNode])).toBe(true)
    expect(reads).toBe(afterFirst)
  })
  it("values that already read as 'nothing' do not make a node clearable", () => {
    const idle = node("i", "generate-image", {
      prompt: "p",
      executionStatus: "idle",
      currentJobProgress: 0,
      activeResultIndex: 0,
      generatedResults: [],
      generatedImageUrl: "",
      errorMessage: undefined,
      isStreaming: false,
      routeOutputs: {},
    })
    expect(hasRunResults([idle])).toBe(false)
    // …but a zero or a false that IS a verdict still counts.
    expect(hasRunResults([node("qa", "qa-check", { score: 0 })])).toBe(true)
    expect(hasRunResults([node("qa", "qa-check", { approved: false })])).toBe(true)
  })

  it.each([
    ["executionStatus", "running"],
    ["executionStatus", "pending"],
    ["isStreaming", true],
    ["__listRunning", true],
    ["jobAwaitingReview", true],
  ])("a node with %s = %s means a run is in progress", (key, value) => {
    expect(isRunInProgress([node("a", "generate-image"), node("b", "llm-chat", { [key]: value })])).toBe(true)
  })

  it("never lifts the mark of a paid run still out, which the clear does not stop (T100)", () => {
    // The run goes on whatever the clear does. Lifting its mark would let a
    // read-only freeze that waits for it land before its result does.
    const marked = { __runsInFlight: ["run-1"] }
    const character = node("c", "character", { characterName: "Kira", executionStatus: "failed", errorMessage: "no", ...marked })
    const overlay = node("o", "image-overlay", { generatedImageUrl: RESULT.url, ...marked })
    const out = clear([character, overlay], [])!
    expect(dataOf(byId(out.nodes, "c"))).toMatchObject({ characterName: "Kira", ...marked })
    expect(dataOf(byId(out.nodes, "c")).errorMessage).toBeUndefined()
    expect(dataOf(byId(out.nodes, "o"))).toMatchObject(marked)
    expect(dataOf(byId(out.nodes, "o")).generatedImageUrl).toBeUndefined()
    // Nor does the mark alone light the button.
    expect(hasRunResults([node("m", "character", marked), node("n", "generate-image", marked)])).toBe(false)
  })

  it("finished, failed and idle nodes do not", () => {
    expect(
      isRunInProgress([
        node("a", "generate-image", { executionStatus: "completed" }),
        node("b", "generate-image", { executionStatus: "failed" }),
        node("c", "generate-image", { executionStatus: "idle", isStreaming: false }),
      ]),
    ).toBe(false)
  })
})

describe("the key set is derived from the registry, and every exception is on the record", () => {
  it("every EXECUTION_DATA_KEYS member is either cleared or kept for a stated reason", () => {
    const everything = Object.fromEntries([...EXECUTION_DATA_KEYS].map((key) => [key, "value"]))
    const data = (clear([node("n", "generate-image", everything)], [])?.nodes[0].data ?? {}) as Record<string, unknown>
    const survivors = Object.keys(data).filter((key) => key !== "label").sort()
    expect(survivors).toEqual([...RUN_RESULT_KEEP_KEYS.keys()].sort())
    for (const [key, reason] of RUN_RESULT_KEEP_KEYS) {
      expect(EXECUTION_DATA_KEYS.has(key), `${key} is not in the registry — it needs no exemption`).toBe(true)
      expect(reason.length, key).toBeGreaterThan(10)
    }
  })

  it("the keep list is exactly this — a key joins it only with a reason a reviewer has read", () => {
    expect([...RUN_RESULT_KEEP_KEYS.keys()].sort()).toEqual([
      "__runsInFlight",
      "loraReplicateVersion",
      "loraTrainingStatus",
      "loraTriggerWord",
      "resultsClearedAt",
      "shots",
      "sourceImageUrl",
      "zoom",
    ])
  })

  it("keeps whatever a template export keeps — config filed as runtime is config in both places", () => {
    // `stripExportContent` has its own exemption list for the same registry. A
    // key it preserves is user config; clearing it here would delete that config.
    const everything = Object.fromEntries([...EXECUTION_DATA_KEYS].map((key) => [key, "value"]))
    const [exported] = stripExportContent([{ id: "n", type: "generate-image", position: { x: 0, y: 0 }, data: everything }])
    const keptByExport = Object.keys(exported.data as Record<string, unknown>)
    expect(keptByExport.length).toBeGreaterThan(0)
    for (const key of keptByExport) expect(RUN_RESULT_KEEP_KEYS.has(key), key).toBe(true)
  })

  it("removing a result never LOOKS like a config change to the inline nodes that re-run on one", () => {
    // combine-text, selector, router… re-execute 300 ms after any change to a
    // key outside this set. A cleared key it does not know about would bring the
    // node's result straight back — and keep the Clear button lit forever.
    const removed = [...EXECUTION_DATA_KEYS, ...RUN_RESULT_EXTRA_KEYS]
    expect(removed.filter((key) => !AUTO_EXECUTE_IGNORE_KEYS.has(key))).toEqual([])
  })

  it("the extra keys are really extra, and never a plan document", () => {
    for (const key of RUN_RESULT_EXTRA_KEYS) {
      expect(EXECUTION_DATA_KEYS.has(key), `${key} is already in the registry`).toBe(false)
      expect(COMPOSER_PLAN_FIELDS.includes(key), `${key} is a plan document`).toBe(false)
    }
    expect(new Set(RUN_RESULT_EXTRA_KEYS).size).toBe(RUN_RESULT_EXTRA_KEYS.length)
    for (const keys of Object.values(RUN_RESULT_TYPE_KEYS)) {
      for (const key of keys) expect(COMPOSER_PLAN_FIELDS.includes(key), key).toBe(false)
    }
  })
})
