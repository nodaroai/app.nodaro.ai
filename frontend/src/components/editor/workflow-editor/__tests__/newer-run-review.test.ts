/**
 * TA3 (c), decided 2026-10-04 and 2026-10-05 — reopening the editor after a run
 * ended while it was closed: on a canvas with a render, every node the run
 * actually ran takes the newer run whole, except a node upstream of one that
 * keeps a different, newer run (so a plan and its render stay a pair). A canvas
 * with no render only fills what is empty. Real payloads: the staging executions in the fixture (see
 * server-run-json-results.test.ts for their provenance).
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { restoreEndedEditorRun } from "@/hooks/use-workflow-persistence"
import { REVIEW_RENDER_NODE_TYPES, edlPathIds, heldBackIds, laterSingleNodeRunIds, pairedHoldIds, reviewRegionIds } from "../newer-run-review"
import fixture from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/server-run-json-results.json"

type Data = Record<string, unknown>
type Run = { readonly id: string; readonly triggerType: string; readonly status: string; readonly createdAt: string; readonly completedAt: string; readonly nodeStates: Record<string, Data> }

const FULL = fixture.fullRun as unknown as Run
const FROM_RENDER = fixture.runFromRender as unknown as Run
const EDGES = fixture.workflow.edges as unknown as WorkflowEdge[]
const outputOf = (run: Run, id: string) => run.nodeStates[id]!.output as Data
const PLAN = outputOf(FULL, "a50-plan").json
const TRANSCRIPT = outputOf(FULL, "a50-transcribe").json
const SILENCE = outputOf(FULL, "a50-silence").json
const RENDER_1 = outputOf(FULL, "a50-apply").audioUrl as string
const RENDER_2 = outputOf(FROM_RENDER, "a50-apply").audioUrl as string

// What an EARLIER run left on the canvas: an older plan, transcript, ranges and preview.
const OLD_PLAN = { version: 1, clock: "master", sources: [], segments: [{ id: "seg-0", inMs: 0, outMs: 41866, audio: "a50-src" }], dropped: [] }
const OLD_TRANSCRIPT = { version: 1, words: [{ text: "Hello", startMs: 0, endMs: 300 }] }
const OLD_RENDER = "https://media.example.test/a50/render-0.m4a"
const OLD_TAKE = { text: "Hello", language: "eng", jobId: "job-old-transcribe", timestamp: "2026-10-04T20:00:00.000Z", transcript: OLD_TRANSCRIPT }

function canvas(extra: Record<string, Data> = {}): WorkflowNode[] {
  return fixture.workflow.nodes.map((n) => ({ ...n, data: { ...n.data, ...(extra[n.id] ?? {}) } })) as unknown as WorkflowNode[]
}
const older = (extra: Record<string, Data> = {}) =>
  canvas({
    "a50-transcribe": { generatedText: "Hello", generatedJson: OLD_TRANSCRIPT, generatedResults: [OLD_TAKE], activeResultIndex: 0 },
    "a50-silence": { generatedJson: { version: 1, ranges: [], durationMs: 41866 } },
    "a50-plan": { generatedJson: OLD_PLAN },
    "a50-apply": { generatedAudioUrl: OLD_RENDER, generatedResults: [{ url: OLD_RENDER, timestamp: "2026-10-04T20:01:00.000Z", jobId: "job-old-render" }], activeResultIndex: 0 },
    ...extra,
  })
const dataOf = (nodes: readonly WorkflowNode[], id: string) => (nodes.find((n) => n.id === id)?.data ?? {}) as Data
const activeTake = (data: Data) => (data.generatedResults as Data[] | undefined)?.[(data.activeResultIndex as number | undefined) ?? 0]

describe("the review region", () => {
  it("is every node on a canvas with a render (Apply EDL today) — the tail after the render too (decided 2026-10-05)", () => {
    expect([...REVIEW_RENDER_NODE_TYPES]).toEqual(["apply-edl"])
    const nodes = [...canvas(), { id: "caps", type: "add-captions", position: { x: 0, y: 0 }, data: {} }, { id: "thumb", type: "generate-image", position: { x: 0, y: 0 }, data: {} }] as unknown as WorkflowNode[]
    expect([...reviewRegionIds(nodes)].sort()).toEqual(["a50-apply", "a50-plan", "a50-silence", "a50-src", "a50-transcribe", "caps", "thumb"])
  })

  it("is empty on a canvas with no render, which keeps today's fill-only reopen", () => {
    const nodes = canvas().filter((n) => n.type !== "apply-edl")
    expect(reviewRegionIds(nodes).size).toBe(0)
  })
})

describe("the nodes held back so a plan and its render come from the same run (decided 2026-10-05)", () => {
  it("is every node upstream of one that keeps a newer run, through any wire", () => {
    expect([...heldBackIds(canvas(), EDGES, new Set(["a50-apply"]))].sort()).toEqual(["a50-plan", "a50-silence", "a50-src", "a50-transcribe"])
    expect([...heldBackIds(canvas(), EDGES, new Set(["a50-plan"]))].sort()).toEqual(["a50-silence", "a50-src", "a50-transcribe"])
    expect(heldBackIds(canvas(), EDGES, new Set()).size).toBe(0)
  })

  it("follows a teleport back to the node that feeds it", () => {
    const nodes = [
      { id: "plan", type: "edit-plan", data: {} },
      { id: "send", type: "teleport-send", data: { channel: "A" } },
      { id: "recv", type: "teleport-receive", data: { channel: "A" } },
      { id: "cut", type: "apply-edl", data: {} },
      { id: "elsewhere", type: "llm-chat", data: {} },
    ]
    const edges = [{ source: "plan", target: "send" }, { source: "recv", target: "cut" }]
    expect([...heldBackIds(nodes, edges, new Set(["cut"]))].sort()).toEqual(["plan", "recv", "send"])
  })
})

describe("a run that ended while the editor was closed", () => {
  it("loads onto the render and every node upstream of it that the run ran — over the older results — and marks each one", () => {
    const out = restoreEndedEditorRun(older(), EDGES, FULL, [FULL])
    expect(dataOf(out, "a50-plan").generatedJson).toEqual(PLAN)
    expect(dataOf(out, "a50-silence").generatedJson).toEqual(SILENCE)
    const transcribe = dataOf(out, "a50-transcribe")
    expect(transcribe.generatedJson).toEqual(TRANSCRIPT)
    expect(activeTake(transcribe)).toMatchObject({ transcript: TRANSCRIPT })
    expect(transcribe.generatedResults).toHaveLength(2)
    const apply = dataOf(out, "a50-apply")
    expect(apply.generatedAudioUrl).toBe(RENDER_1)
    expect(activeTake(apply)).toMatchObject({ url: RENDER_1 })
    for (const id of ["a50-transcribe", "a50-silence", "a50-plan", "a50-apply"]) {
      expect(dataOf(out, id).resultsRunId, id).toBe(FULL.id)
    }
    // The upload only passed its file through.
    expect(dataOf(out, "a50-src").generatedAudioUrl).toBeUndefined()
    expect(dataOf(out, "a50-src").resultsRunId).toBeUndefined()
  })

  it("never loads the same run twice over what changed since (a node already showing it is left alone)", () => {
    const once = restoreEndedEditorRun(older(), EDGES, FULL, [FULL])
    // After the reopen the person edits the plan, picks the older transcript
    // take again, and picks the older preview — dropping the run's own take
    // from the render, so only the stamp says the render already shows the run.
    const EDITED_PLAN = { ...(PLAN as Data), segments: [] }
    const edited = once.map((n) => {
      const data = n.data as Data
      if (n.id === "a50-plan") return { ...n, data: { ...data, generatedJson: EDITED_PLAN } }
      if (n.id === "a50-transcribe") return { ...n, data: { ...data, activeResultIndex: 1, generatedJson: OLD_TRANSCRIPT, generatedText: "Hello" } }
      if (n.id === "a50-apply") {
        const takes = (data.generatedResults as Data[]).filter((t) => t.url !== RENDER_1)
        return { ...n, data: { ...data, generatedResults: takes, activeResultIndex: 0, generatedAudioUrl: OLD_RENDER } }
      }
      return n
    }) as WorkflowNode[]
    const twice = restoreEndedEditorRun(edited, EDGES, FULL, [FULL])
    for (const id of ["a50-plan", "a50-transcribe", "a50-apply", "a50-silence"]) {
      expect(dataOf(twice, id), id).toEqual(dataOf(edited, id))
    }
  })

  it("marks each node it loads with when the run ended it, beside the run's id", () => {
    const out = restoreEndedEditorRun(older(), EDGES, FULL, [FULL])
    expect(dataOf(out, "a50-plan").resultsRunEndedAt).toBe(FULL.nodeStates["a50-plan"]!.completedAt)
    expect(dataOf(out, "a50-apply").resultsRunEndedAt).toBe(FULL.nodeStates["a50-apply"]!.completedAt)
  })

  describe("a node showing a run the reopening listing does not hold (another member's, a discarded one, a Telegram run)", () => {
    const NEWER_PLAN = { version: 1, clock: "master", sources: [], segments: [{ id: "seg-b", inMs: 0, outMs: 1000, audio: "a50-src" }], dropped: [] }
    const NEWER_RENDER = "https://media.example.test/a50/render-b.m4a"
    const after = new Date(Date.parse(FULL.completedAt) + 60_000).toISOString()
    const before = new Date(Date.parse(FULL.nodeStates["a50-plan"]!.completedAt as string) - 60_000).toISOString()
    const showing = (runId: string, endedAt?: string) => ({ resultsRunId: runId, ...(endedAt ? { resultsRunEndedAt: endedAt } : {}) })

    it("keeps a result a NEWER run left, plan and render alike", () => {
      const nodes = older({
        "a50-plan": { generatedJson: NEWER_PLAN, ...showing("run-b", after) },
        "a50-apply": { generatedAudioUrl: NEWER_RENDER, generatedResults: [{ url: NEWER_RENDER, timestamp: after, jobId: "job-b" }], activeResultIndex: 0, ...showing("run-b", after) },
      })
      const out = restoreEndedEditorRun(nodes, EDGES, FULL, [FULL])
      expect(dataOf(out, "a50-plan")).toEqual(dataOf(nodes, "a50-plan"))
      expect(dataOf(out, "a50-apply")).toEqual(dataOf(nodes, "a50-apply"))
    })

    it("a render that keeps a NEWER run holds back the plan feeding it, and everything upstream (decided 2026-10-05)", () => {
      const nodes = older({
        "a50-apply": { generatedAudioUrl: NEWER_RENDER, generatedResults: [{ url: NEWER_RENDER, timestamp: after, jobId: "job-b" }], activeResultIndex: 0, ...showing("run-b", after) },
      })
      const out = restoreEndedEditorRun(nodes, EDGES, FULL, [FULL])
      for (const id of ["a50-apply", "a50-plan", "a50-transcribe", "a50-silence"]) {
        expect(dataOf(out, id), id).toEqual(dataOf(nodes, id))
      }
    })

    it("…even when the run did not run the render (Run selected on the plan alone)", () => {
      const planOnly: Run = { ...FULL, nodeStates: { "a50-plan": FULL.nodeStates["a50-plan"]! } }
      const nodes = older({
        "a50-apply": { generatedAudioUrl: NEWER_RENDER, generatedResults: [{ url: NEWER_RENDER, timestamp: after, jobId: "job-b" }], activeResultIndex: 0, ...showing("run-b", after) },
      })
      expect(dataOf(restoreEndedEditorRun(nodes, EDGES, planOnly, [planOnly]), "a50-plan")).toEqual(dataOf(nodes, "a50-plan"))
    })

    it("loads over a result an OLDER run left, even when that run has left the listing", () => {
      const out = restoreEndedEditorRun(older({ "a50-plan": showing("run-gone", before) }), EDGES, FULL, [FULL])
      expect(dataOf(out, "a50-plan").generatedJson).toEqual(PLAN)
      expect(dataOf(out, "a50-plan").resultsRunId).toBe(FULL.id)
    })

    it("a mark with no end time (made before the end was recorded) loads over when its run is not listed…", () => {
      // Only the Telegram follow lane stamped before the end time was recorded,
      // and it repaints a Telegram run newer than this one by itself.
      const nodes = older({ "a50-plan": { generatedJson: NEWER_PLAN, ...showing("run-unlisted") } })
      expect(dataOf(restoreEndedEditorRun(nodes, EDGES, FULL, [FULL]), "a50-plan").generatedJson).toEqual(PLAN)
    })

    it("…and is read off the listed run when it is", () => {
      const listedOlder = { ...FULL, id: "run-listed-older", completedAt: before, nodeStates: {} }
      const listedNewer = { ...FULL, id: "run-listed-newer", completedAt: after, nodeStates: {} }
      const olderMark = older({ "a50-plan": { generatedJson: NEWER_PLAN, ...showing(listedOlder.id) } })
      expect(dataOf(restoreEndedEditorRun(olderMark, EDGES, FULL, [FULL, listedOlder]), "a50-plan").generatedJson).toEqual(PLAN)
      const newerMark = older({ "a50-plan": { generatedJson: NEWER_PLAN, ...showing(listedNewer.id) } })
      expect(dataOf(restoreEndedEditorRun(newerMark, EDGES, FULL, [listedNewer, FULL]), "a50-plan").generatedJson).toEqual(NEWER_PLAN)
    })
  })

  it("a render that landed before runs were stamped (an older editor painted it live) is left as the person left it", () => {
    // render-1 is already one of the takes, and the older preview is picked again.
    const nodes = older({
      "a50-apply": {
        generatedAudioUrl: OLD_RENDER,
        generatedResults: [
          { url: RENDER_1, timestamp: "2026-10-04T21:28:46.455Z", jobId: FULL.nodeStates["a50-apply"]!.jobId },
          { url: OLD_RENDER, timestamp: "2026-10-04T20:01:00.000Z", jobId: "job-old-render" },
        ],
        activeResultIndex: 1,
      },
    })
    const out = restoreEndedEditorRun(nodes, EDGES, FULL, [FULL])
    expect(dataOf(out, "a50-apply")).toEqual(dataOf(nodes, "a50-apply"))
    // No server run ever landed the plan before A5.0: it loads.
    expect(dataOf(out, "a50-plan").generatedJson).toEqual(PLAN)
  })

  it("a Run from here at the render loads the render only: the nodes it seeded keep what they hold", () => {
    const landed = restoreEndedEditorRun(older(), EDGES, FULL, [FULL])
    const out = restoreEndedEditorRun(landed, EDGES, FROM_RENDER, [FROM_RENDER, FULL])
    expect(dataOf(out, "a50-apply").generatedAudioUrl).toBe(RENDER_2)
    expect(dataOf(out, "a50-apply").resultsRunId).toBe(FROM_RENDER.id)
    for (const id of ["a50-src", "a50-transcribe", "a50-silence", "a50-plan"]) {
      expect(dataOf(out, id), id).toEqual(dataOf(landed, id))
    }
  })

  it("a node emptied with Clear results after the run ended stays empty; the rest still load", () => {
    const clearedAt = new Date(Date.parse(FULL.completedAt) + 60_000).toISOString()
    const out = restoreEndedEditorRun(older({ "a50-plan": { resultsClearedAt: clearedAt } }), EDGES, FULL, [FULL])
    expect(dataOf(out, "a50-plan").generatedJson).toBeUndefined()
    expect(dataOf(out, "a50-apply").generatedAudioUrl).toBe(RENDER_1)
  })

  it("a render emptied with Clear results does not hold back the plan: only a NEWER run does", () => {
    const clearedAt = new Date(Date.parse(FULL.completedAt) + 60_000).toISOString()
    const out = restoreEndedEditorRun(older({ "a50-apply": { generatedAudioUrl: undefined, generatedResults: [], resultsClearedAt: clearedAt } }), EDGES, FULL, [FULL])
    expect(dataOf(out, "a50-apply").generatedAudioUrl).toBeUndefined()
    expect(dataOf(out, "a50-plan").generatedJson).toEqual(PLAN)
  })

  describe("a later single-node run still wins", () => {
    const applyEnded = Date.parse(FULL.nodeStates["a50-apply"]!.completedAt as string)
    const singleNode = (offsetMs: number) => ({
      id: "f4d3a8c1-0000-4000-8000-000000000001",
      triggerType: "single-node",
      status: "completed",
      createdAt: new Date(applyEnded + offsetMs - 5_000).toISOString(),
      completedAt: new Date(applyEnded + offsetMs).toISOString(),
      nodeStates: { "a50-apply": { nodeId: "a50-apply", jobId: "f4d3a8c1-0000-4000-8000-000000000001", status: "completed" } },
    })
    const NEWER = "https://media.example.test/a50/render-single.m4a"

    it("the render keeps the newer single-node render, and the plan feeding it (and all upstream) keeps what it holds too", () => {
      const nodes = older({ "a50-apply": { generatedAudioUrl: NEWER, generatedResults: [{ url: NEWER, timestamp: "x", jobId: "f4d3a8c1-0000-4000-8000-000000000001" }], activeResultIndex: 0 } })
      const out = restoreEndedEditorRun(nodes, EDGES, FULL, [singleNode(60_000), FULL])
      expect(dataOf(out, "a50-apply").generatedAudioUrl).toBe(NEWER)
      for (const id of ["a50-plan", "a50-transcribe", "a50-silence", "a50-apply"]) {
        expect(dataOf(out, id), id).toEqual(dataOf(nodes, id))
      }
    })

    it("…and an empty render is not filled with the older run either (the single-node result is recovered instead), nor is an empty plan feeding it", () => {
      const out = restoreEndedEditorRun(canvas(), EDGES, FULL, [singleNode(60_000), FULL])
      expect(dataOf(out, "a50-apply").generatedAudioUrl).toBeUndefined()
      expect(dataOf(out, "a50-plan").generatedJson).toBeUndefined()
      expect(dataOf(out, "a50-transcribe").generatedJson).toBeUndefined()
    })

    it("a single-node run that ended BEFORE the run's render does not hold it back", () => {
      const out = restoreEndedEditorRun(older(), EDGES, FULL, [FULL, singleNode(-60_000)])
      expect(dataOf(out, "a50-apply").generatedAudioUrl).toBe(RENDER_1)
    })

    it("only a COMPLETED single-node run counts", () => {
      expect(laterSingleNodeRunIds([{ ...singleNode(60_000), status: "failed" }], FULL.nodeStates, FULL).size).toBe(0)
      expect([...laterSingleNodeRunIds([singleNode(60_000)], FULL.nodeStates, FULL)]).toEqual(["a50-apply"])
    })
  })

  it("a Choose Best upstream of the render gets its winner and the judge's meta", () => {
    const best = { id: "best", type: "reduce", position: { x: 0, y: 0 }, data: { label: "Choose Best", result: "older winner" } }
    const edges = [...EDGES, { id: "e10", source: "best", sourceHandle: "result", target: "a50-apply", targetHandle: "edl" }] as unknown as WorkflowEdge[]
    const meta = { strategy: "judge", reason: "tighter cut" }
    const run: Run = {
      ...FULL,
      nodeStates: { ...FULL.nodeStates, best: { status: "completed", startedAt: FULL.completedAt, completedAt: FULL.completedAt, output: { result: "newer winner", reduceMeta: meta } } },
    }
    const out = restoreEndedEditorRun([...older(), best] as unknown as WorkflowNode[], edges, run, [run])
    expect(dataOf(out, "best")).toMatchObject({ result: "newer winner", lastMeta: meta, resultsRunId: run.id })
  })

  describe("the tail after the render (decided 2026-10-05)", () => {
    const captions = { id: "caps", type: "add-captions", position: { x: 0, y: 0 }, data: { label: "Captions" } }
    const edges = [...EDGES, { id: "e9", source: "a50-apply", sourceHandle: "media", target: "caps", targetHandle: "in" }] as unknown as WorkflowEdge[]
    const CAPS_NEW = "https://media.example.test/a50/captioned-new.mp4"
    const CAPS_OLD = "https://media.example.test/a50/captioned-old.mp4"
    const run: Run = {
      ...FULL,
      nodeStates: { ...FULL.nodeStates, caps: { status: "completed", startedAt: FULL.completedAt, completedAt: FULL.completedAt, output: { videoUrl: CAPS_NEW } } },
    }

    it("loads too, over what an older run left on it, and is marked with the run", () => {
      const beforeRun = new Date(Date.parse(FULL.completedAt) - 3_600_000).toISOString()
      const holding = [...older(), { ...captions, data: { ...captions.data, generatedVideoUrl: CAPS_OLD, resultsRunId: "run-old", resultsRunEndedAt: beforeRun } }] as unknown as WorkflowNode[]
      const out = restoreEndedEditorRun(holding, edges, run, [run])
      expect(dataOf(out, "caps").generatedVideoUrl).toBe(CAPS_NEW)
      expect(dataOf(out, "caps").resultsRunId).toBe(run.id)
      expect(dataOf(out, "a50-apply").generatedAudioUrl).toBe(RENDER_1)
    })

    it("so does a node on the canvas no render reads from, once a run has marked it (every node the run ran)", () => {
      const beforeRun = new Date(Date.parse(FULL.completedAt) - 3_600_000).toISOString()
      const thumb = { id: "thumb", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "Thumb", generatedImageUrl: "https://media.example.test/a50/thumb-old.png", resultsRunId: "run-old", resultsRunEndedAt: beforeRun } }
      const withThumb: Run = { ...FULL, nodeStates: { ...FULL.nodeStates, thumb: { status: "completed", startedAt: FULL.completedAt, completedAt: FULL.completedAt, output: { imageUrl: "https://media.example.test/a50/thumb-new.png" } } } }
      const out = restoreEndedEditorRun([...older(), thumb] as unknown as WorkflowNode[], EDGES, withThumb, [withThumb])
      expect(dataOf(out, "thumb").generatedImageUrl).toBe("https://media.example.test/a50/thumb-new.png")
    })

    it("a caption that keeps a NEWER run holds back the render, the plan and everything upstream", () => {
      const after = new Date(Date.parse(FULL.completedAt) + 60_000).toISOString()
      const holding = [...older(), { ...captions, data: { ...captions.data, generatedVideoUrl: CAPS_OLD, resultsRunId: "run-b", resultsRunEndedAt: after } }] as unknown as WorkflowNode[]
      const out = restoreEndedEditorRun(holding, edges, run, [run])
      for (const id of ["caps", "a50-apply", "a50-plan", "a50-transcribe", "a50-silence"]) {
        expect(dataOf(out, id), id).toEqual(dataOf(holding, id))
      }
    })
  })
})

describe("plan, transcript and render come from one run — review round 3 (decided 2026-10-05)", () => {
  const after = new Date(Date.parse(FULL.completedAt) + 60_000).toISOString()
  const newerMark = { resultsRunId: "run-b", resultsRunEndedAt: after }
  const ON_PATH = ["a50-src", "a50-transcribe", "a50-silence", "a50-plan", "a50-apply"]
  const at = (id: string, x = 0) => ({ id, position: { x, y: 0 } })

  describe("the edl path", () => {
    it("is every render and every node upstream of one — not the tail after it, nor a branch no render reads from", () => {
      const nodes = [
        ...canvas(),
        { ...at("caps"), type: "add-captions", data: {} },
        { ...at("title"), type: "llm-chat", data: {} },
        { ...at("thumb"), type: "generate-image", data: {} },
      ]
      const edges = [...EDGES, { source: "a50-apply", target: "caps" }, { source: "a50-transcribe", target: "title" }]
      expect([...edlPathIds(nodes, edges)].sort()).toEqual([...ON_PATH].sort())
    })
  })

  describe("what a hold reaches", () => {
    const nodes = [
      { id: "plan", type: "edit-plan", data: {} },
      { id: "cam", type: "camera-switch", data: {} },
      { id: "cut", type: "apply-edl", data: {} },
      { id: "caps", type: "add-captions", data: {} },
    ]
    const edges = [{ source: "plan", target: "cam" }, { source: "cam", target: "cut" }, { source: "cut", target: "caps" }]

    it("F1: a plan that keeps a newer run holds back the renders it feeds, and every node between them — never the tail", () => {
      expect([...pairedHoldIds(nodes, edges, new Set(["plan"]))].sort()).toEqual(["cam", "cut"])
    })

    it("F1: so does a node between the plan and the render, both ways", () => {
      expect([...pairedHoldIds(nodes, edges, new Set(["cam"]))].sort()).toEqual(["cut", "plan"])
    })

    it("F2: a node held back holds back what it feeds on the edl path — a title off the transcript holds the transcript, the plan and the render", () => {
      const withTitle = [...canvas(), { ...at("title"), type: "llm-chat", data: {} }]
      const edges2 = [...EDGES, { source: "a50-transcribe", target: "title" }]
      expect([...pairedHoldIds(withTitle, edges2, new Set(["title"]))].sort()).toEqual([...ON_PATH].sort())
    })
  })

  describe("F1: a plan, or a node between it and the render, keeps a newer run", () => {
    it("a plan showing a newer run holds back the render it feeds", () => {
      const nodes = older({ "a50-plan": newerMark })
      const out = restoreEndedEditorRun(nodes, EDGES, FULL, [FULL])
      expect(dataOf(out, "a50-plan")).toEqual(dataOf(nodes, "a50-plan"))
      expect(dataOf(out, "a50-apply")).toEqual(dataOf(nodes, "a50-apply"))
    })

    it("a plan re-run on its own after it finished in the run — while the run was still rendering — holds back the run's render", () => {
      const planEnded = Date.parse(FULL.nodeStates["a50-plan"]!.completedAt as string)
      const planSingle = {
        id: "f4d3a8c1-0000-4000-8000-000000000002",
        triggerType: "single-node",
        status: "completed",
        createdAt: new Date(planEnded + 200).toISOString(),
        completedAt: new Date(planEnded + 1_000).toISOString(),
        nodeStates: { "a50-plan": { nodeId: "a50-plan", jobId: "f4d3a8c1-0000-4000-8000-000000000002", status: "completed" } },
      }
      expect(planEnded + 1_000).toBeLessThan(Date.parse(FULL.nodeStates["a50-apply"]!.completedAt as string))
      const nodes = older()
      const out = restoreEndedEditorRun(nodes, EDGES, FULL, [planSingle, FULL])
      expect(dataOf(out, "a50-apply")).toEqual(dataOf(nodes, "a50-apply"))
      expect(dataOf(out, "a50-plan")).toEqual(dataOf(nodes, "a50-plan"))
    })

    it("a Choose Best between the plan and the render that keeps a newer run holds back the render, and the plan", () => {
      const best = { ...at("best"), type: "reduce", data: { label: "Choose Best", result: "newer winner", ...newerMark } }
      const edges = [...EDGES.filter((e) => !(e.source === "a50-plan" && e.target === "a50-apply")),
        { id: "e-pb", source: "a50-plan", sourceHandle: "json", target: "best", targetHandle: "in" },
        { id: "e-ba", source: "best", sourceHandle: "result", target: "a50-apply", targetHandle: "edl" }] as unknown as WorkflowEdge[]
      const run: Run = { ...FULL, nodeStates: { ...FULL.nodeStates, best: { status: "completed", startedAt: FULL.completedAt, completedAt: FULL.nodeStates["a50-plan"]!.completedAt as string, output: { result: "run winner" } } } }
      const nodes = [...older(), best] as unknown as WorkflowNode[]
      const out = restoreEndedEditorRun(nodes, edges, run, [run])
      for (const id of ["best", "a50-apply", "a50-plan"]) expect(dataOf(out, id), id).toEqual(dataOf(nodes, id))
    })
  })

  describe("F2: a node held back holds back what it feeds on the edl path", () => {
    it("a title writer off the Transcribe that keeps a newer run holds back the Transcribe, the plan and the render cut from it", () => {
      const title = { ...at("title"), type: "llm-chat", data: { label: "Title", generatedText: "Newer title", ...newerMark } }
      const edges = [...EDGES, { id: "e-tt", source: "a50-transcribe", sourceHandle: "text", target: "title", targetHandle: "prompt" }] as unknown as WorkflowEdge[]
      const nodes = [...older(), title] as unknown as WorkflowNode[]
      const out = restoreEndedEditorRun(nodes, edges, FULL, [FULL])
      for (const id of ["title", "a50-transcribe", "a50-silence", "a50-plan", "a50-apply"]) {
        expect(dataOf(out, id), id).toEqual(dataOf(nodes, id))
      }
    })
  })

  describe("F3: a render that failed in the run holds back its plan", () => {
    const failed: Run = {
      ...FULL,
      nodeStates: {
        ...FULL.nodeStates,
        "a50-apply": { status: "failed", nodeType: "apply-edl", jobId: FULL.nodeStates["a50-apply"]!.jobId, startedAt: FULL.nodeStates["a50-apply"]!.startedAt, completedAt: FULL.nodeStates["a50-apply"]!.completedAt, error: "Render failed" },
      },
    }

    it("the plan, transcript and ranges keep what they hold; the render shows the failure and keeps its earlier preview", () => {
      const nodes = older()
      const out = restoreEndedEditorRun(nodes, EDGES, failed, [failed])
      for (const id of ["a50-plan", "a50-transcribe", "a50-silence"]) expect(dataOf(out, id), id).toEqual(dataOf(nodes, id))
      expect(dataOf(out, "a50-apply")).toMatchObject({ executionStatus: "failed", generatedAudioUrl: OLD_RENDER })
    })

    it("…and still does on the next reopen, once the render is marked with the run", () => {
      const once = restoreEndedEditorRun(older(), EDGES, failed, [failed])
      const twice = restoreEndedEditorRun(once, EDGES, failed, [failed])
      expect(dataOf(twice, "a50-plan").generatedJson).toEqual(OLD_PLAN)
      expect(dataOf(twice, "a50-transcribe").generatedJson).toEqual(OLD_TRANSCRIPT)
    })

    it("an empty plan is not filled from the run either", () => {
      const out = restoreEndedEditorRun(canvas(), EDGES, failed, [failed])
      expect(dataOf(out, "a50-plan").generatedJson).toBeUndefined()
    })
  })

  describe("a render the run never finished holds back its plan, as a failed one does (decided 2026-10-05)", () => {
    const applied = FULL.nodeStates["a50-apply"]!
    const endedWith = (render: Data): Run => ({ ...FULL, nodeStates: { ...FULL.nodeStates, "a50-apply": render } })
    // Failed upstream (a Camera Switch), or stopped before the render started: it never left the queue.
    const neverStarted = endedWith({ status: "pending", nodeType: "apply-edl" })
    // Stopped, timed out or abandoned mid-render: still "running" when the run ended.
    const midRender = endedWith({ status: "running", nodeType: "apply-edl", jobId: applied.jobId, startedAt: applied.startedAt })
    // Stopped mid-render, then settled by the reconciler: a cancelled job reads back as "skipped".
    const cancelled = endedWith({ status: "skipped", nodeType: "apply-edl", jobId: applied.jobId, startedAt: applied.startedAt, completedAt: applied.completedAt })

    for (const [label, run] of [["pending", neverStarted], ["running", midRender], ["cancelled (skipped, with its job)", cancelled]] as const) {
      it(`${label}: the plan, transcript and ranges keep what they hold; the render keeps its earlier preview`, () => {
        const nodes = older()
        const out = restoreEndedEditorRun(nodes, EDGES, run, [run])
        for (const id of ["a50-plan", "a50-transcribe", "a50-silence", "a50-apply"]) expect(dataOf(out, id), id).toEqual(dataOf(nodes, id))
      })
    }

    it("…and still does on the next reopen", () => {
      const once = restoreEndedEditorRun(older(), EDGES, midRender, [midRender])
      const twice = restoreEndedEditorRun(once, EDGES, midRender, [midRender])
      expect(dataOf(twice, "a50-plan").generatedJson).toEqual(OLD_PLAN)
      expect(dataOf(twice, "a50-transcribe").generatedJson).toEqual(OLD_TRANSCRIPT)
      expect(dataOf(twice, "a50-apply").generatedAudioUrl).toBe(OLD_RENDER)
    })

    it("an empty plan is not filled from the run either", () => {
      expect(dataOf(restoreEndedEditorRun(canvas(), EDGES, neverStarted, [neverStarted]), "a50-plan").generatedJson).toBeUndefined()
    })

    it("a plan that failed leaves the render pending: the transcript and ranges keep what they hold too", () => {
      const planFailed: Run = {
        ...neverStarted,
        nodeStates: { ...neverStarted.nodeStates, "a50-plan": { status: "failed", nodeType: "edit-plan", jobId: "job-plan-failed", startedAt: FULL.nodeStates["a50-plan"]!.startedAt, completedAt: FULL.nodeStates["a50-plan"]!.completedAt, error: "Plan failed" } },
      }
      const nodes = older()
      const out = restoreEndedEditorRun(nodes, EDGES, planFailed, [planFailed])
      for (const id of ["a50-plan", "a50-transcribe", "a50-silence", "a50-apply"]) expect(dataOf(out, id), id).toEqual(dataOf(nodes, id))
    })

    it("a render the run only passed through (its saved preview handed on) holds nothing back", () => {
      const passedThrough = endedWith({ status: "completed", completedAt: FULL.completedAt, fromSavedData: true })
      const out = restoreEndedEditorRun(older(), EDGES, passedThrough, [passedThrough])
      expect(dataOf(out, "a50-plan").generatedJson).toEqual(PLAN)
      expect(dataOf(out, "a50-apply").generatedAudioUrl).toBe(OLD_RENDER)
    })

    // A Router that turned the render's route off: the orchestrator writes "skipped" with no job and no start.
    const routerSkipped = endedWith({ status: "skipped", nodeType: "apply-edl", completedAt: applied.completedAt })

    it("a render a Router skipped (no job) holds nothing back: the plan and transcript load", () => {
      const out = restoreEndedEditorRun(older(), EDGES, routerSkipped, [routerSkipped])
      expect(dataOf(out, "a50-plan").generatedJson).toEqual(PLAN)
      expect(dataOf(out, "a50-transcribe").generatedJson).toEqual(TRANSCRIPT)
    })

    it("…and with two renders, one the Router picked and one it skipped, the picked render loads with its plan", () => {
      const renderB = { ...canvas().find((n) => n.id === "a50-apply")!, id: "a50-apply-b", data: { label: "Apply Cut B", output: "audio", quality: "proxy", fieldMappings: {} } }
      const edges = [
        ...EDGES,
        { id: "e-b-src", source: "a50-src", sourceHandle: "audio", target: "a50-apply-b", targetHandle: "sources" },
        { id: "e-b-edl", source: "a50-plan", sourceHandle: "edl", target: "a50-apply-b", targetHandle: "edl" },
      ] as unknown as WorkflowEdge[]
      const run: Run = { ...FULL, nodeStates: { ...FULL.nodeStates, "a50-apply-b": { status: "skipped", nodeType: "apply-edl", completedAt: applied.completedAt } } }
      const out = restoreEndedEditorRun([...older(), renderB] as unknown as WorkflowNode[], edges, run, [run])
      expect(dataOf(out, "a50-plan").generatedJson).toEqual(PLAN)
      expect(dataOf(out, "a50-transcribe").generatedJson).toEqual(TRANSCRIPT)
      expect(dataOf(out, "a50-apply").generatedAudioUrl).toBe(RENDER_1)
    })

    it("a render the run did not include holds nothing back (Run selected on the plan alone)", () => {
      const planOnly: Run = { ...FULL, nodeStates: { "a50-plan": FULL.nodeStates["a50-plan"]! } }
      expect(dataOf(restoreEndedEditorRun(older(), EDGES, planOnly, [planOnly]), "a50-plan").generatedJson).toEqual(PLAN)
    })
  })

  describe("F4: a node off the render's upstream path that no run has marked keeps the fill-only rule", () => {
    const captions = { ...at("caps"), type: "add-captions", data: { label: "Captions" } }
    const edges = [...EDGES, { id: "e9", source: "a50-apply", sourceHandle: "media", target: "caps", targetHandle: "in" }] as unknown as WorkflowEdge[]
    const CAPS_NEW = "https://media.example.test/a50/captioned-new.mp4"
    const CAPS_OLD = "https://media.example.test/a50/captioned-old.mp4"
    const run: Run = {
      ...FULL,
      nodeStates: { ...FULL.nodeStates, caps: { status: "completed", jobId: "job-caps", startedAt: FULL.completedAt, completedAt: FULL.completedAt, output: { videoUrl: CAPS_NEW } } },
    }

    it("an unmarked caption that holds a result keeps it, and stays unmarked so the rule applies on the next reopen too", () => {
      const holding = [...older(), { ...captions, data: { ...captions.data, generatedVideoUrl: CAPS_OLD } }] as unknown as WorkflowNode[]
      const out = restoreEndedEditorRun(holding, edges, run, [run])
      expect(dataOf(out, "caps").generatedVideoUrl).toBe(CAPS_OLD)
      expect(dataOf(out, "caps").resultsRunId).toBeUndefined()
      // The render path still loads whole.
      expect(dataOf(out, "a50-apply").generatedAudioUrl).toBe(RENDER_1)
      expect(dataOf(out, "a50-plan").generatedJson).toEqual(PLAN)
    })

    it("an unmarked, empty caption is filled", () => {
      const out = restoreEndedEditorRun([...older(), captions] as unknown as WorkflowNode[], edges, run, [run])
      expect(dataOf(out, "caps").generatedVideoUrl).toBe(CAPS_NEW)
    })

    it("an unmarked branch no render reads from keeps what it holds too", () => {
      const thumb = { ...at("thumb"), type: "generate-image", data: { label: "Thumb", generatedImageUrl: "https://media.example.test/a50/thumb-old.png" } }
      const withThumb: Run = { ...FULL, nodeStates: { ...FULL.nodeStates, thumb: { status: "completed", jobId: "job-thumb", startedAt: FULL.completedAt, completedAt: FULL.completedAt, output: { imageUrl: "https://media.example.test/a50/thumb-new.png" } } } }
      const out = restoreEndedEditorRun([...older(), thumb] as unknown as WorkflowNode[], EDGES, withThumb, [withThumb])
      expect(dataOf(out, "thumb").generatedImageUrl).toBe("https://media.example.test/a50/thumb-old.png")
    })

    it("an unmarked node ON the render's upstream path still loads over what it holds", () => {
      const out = restoreEndedEditorRun(older(), EDGES, FULL, [FULL])
      expect(dataOf(out, "a50-plan").generatedJson).toEqual(PLAN)
    })
  })
})
