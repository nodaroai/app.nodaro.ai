import { describe, it, expect } from "vitest"
import { buildFeedMaps, type FeedNode } from "@nodaro/shared/workflow"
import { continueFromFor, feederReads, feederReadsTheSame, recordedJsonOf, type ContinuableRun } from "../render-final-continuation"
import { jsonRunResultPatch } from "@/lib/json-run-result"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * When the editor's Render final may continue the run whose Preview it renders:
 * only while every node feeding the final reads the same from that run's
 * recorded states as from the saved workflow (the real extractor here, not a
 * mock: an input the run read from its data is compared by its value).
 */
const n = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const e = (source: string, target: string, sourceHandle?: string, targetHandle?: string) =>
  ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}), ...(targetHandle ? { targetHandle } : {}) }) as unknown as WorkflowEdge

/** An Edit Plan's plan as the run made it (a tighten EDL). */
const PLAN = { version: 1, sources: [{ id: "s1", url: "https://cdn/rec.mp4" }], segments: [{ source: "s1", start: 0, end: 4 }] }
/** The same plan as the canvas holds it: keys in another order (JSONB does not keep them). */
const PLAN_REORDERED = { segments: [{ end: 4, start: 0, source: "s1" }], sources: [{ url: "https://cdn/rec.mp4", id: "s1" }], version: 1 }

const RUN: ContinuableRun = {
  id: "exec-prev",
  named: false,
  nodeStates: {
    rec: { status: "completed", fromSavedData: true, output: { videoUrl: "https://cdn/rec.mp4" } },
    note: { status: "completed", fromSavedData: true, output: { text: "Episode 12" } },
    plan: { status: "completed", startedAt: "t", jobId: "j1", output: { json: PLAN } },
    img: { status: "completed", startedAt: "t", jobId: "j2", output: { imageUrl: "https://cdn/b.png" } },
    llm: { status: "completed", startedAt: "t", jobId: "j3", output: { text: "Old caption" } },
  },
}

describe("feederReadsTheSame", () => {
  it("an upload whose file is the one the run read", () => {
    expect(feederReadsTheSame(RUN, n("rec", "upload-video", { url: "https://cdn/rec.mp4" }), undefined)).toBe(true)
  })

  it("an upload whose file was replaced since", () => {
    expect(feederReadsTheSame(RUN, n("rec", "upload-video", { url: "https://cdn/other.mp4" }), undefined)).toBe(false)
  })

  it("a text input unchanged, and the same one edited since", () => {
    expect(feederReadsTheSame(RUN, n("note", "text-prompt", { text: "Episode 12" }), undefined)).toBe(true)
    expect(feederReadsTheSame(RUN, n("note", "text-prompt", { text: "Episode 13" }), undefined)).toBe(false)
  })

  it("a node the run ran: only when the canvas shows that run's result", () => {
    expect(feederReadsTheSame(RUN, n("plan", "edit-plan", { generatedJson: PLAN, resultsRunId: "exec-prev" }), undefined)).toBe(true)
    expect(feederReadsTheSame(RUN, n("plan", "edit-plan", { generatedJson: PLAN, resultsRunId: "job-7" }), undefined)).toBe(false)
    expect(feederReadsTheSame(RUN, n("plan", "edit-plan", { generatedJson: PLAN }), undefined)).toBe(false)
  })

  it("a media take the run made: the canvas must still show THAT take, whatever the stamp says", () => {
    const shows = (url: string) => n("img", "generate-image", { generatedResults: [{ url }], activeResultIndex: 0, resultsRunId: "exec-prev" })
    expect(feederReadsTheSame(RUN, shows("https://cdn/b.png"), undefined)).toBe(true)
    // Take B deleted down to the older take A: one result, the stamp still the run's.
    expect(feederReadsTheSame(RUN, shows("https://cdn/a.png"), undefined)).toBe(false)
    // Every take deleted.
    expect(feederReadsTheSame(RUN, n("img", "generate-image", { generatedResults: [], resultsRunId: "exec-prev" }), undefined)).toBe(false)
  })

  it("a text result the run made: cleared or edited since, it reads as different", () => {
    expect(feederReadsTheSame(RUN, n("llm", "llm-chat", { generatedText: "Old caption", resultsRunId: "exec-prev" }), undefined)).toBe(true)
    expect(feederReadsTheSame(RUN, n("llm", "llm-chat", { generatedText: "New caption", resultsRunId: "exec-prev" }), undefined)).toBe(false)
    expect(feederReadsTheSame(RUN, n("llm", "llm-chat", { resultsRunId: "exec-prev" }), undefined)).toBe(false)
  })

  it("an Edit Plan: compared by the plan before its review, never by the review the server re-applies", () => {
    const edited = { segments: [{ source: "s1", start: 1, end: 4 }] }
    // The canvas holds the same plan (keys reordered) with a review applied on top: still the same.
    expect(feederReadsTheSame(RUN, n("plan", "edit-plan", { generatedJson: PLAN_REORDERED, editedEdl: edited, resultsRunId: "exec-prev" }), undefined)).toBe(true)
    // A run that recorded the plan with a review applied keeps the plan as planned in `plannedJson`.
    const reviewed = { ...RUN, nodeStates: { plan: { status: "completed", jobId: "j1", output: { json: { other: true }, plannedJson: PLAN } } } }
    expect(feederReadsTheSame(reviewed, n("plan", "edit-plan", { generatedJson: PLAN, resultsRunId: "exec-prev" }), undefined)).toBe(true)
    // Planned again since: another plan.
    const replanned = { ...PLAN, segments: [{ source: "s1", start: 0, end: 9 }] }
    expect(feederReadsTheSame(RUN, n("plan", "edit-plan", { generatedJson: replanned, resultsRunId: "exec-prev" }), undefined)).toBe(false)
  })

  it("a node the run has no completed state of: not the same (a continuation would hand on nothing)", () => {
    expect(feederReadsTheSame(RUN, n("other", "generate-image", { resultsRunId: "exec-prev" }), undefined)).toBe(false)
  })

  it("a recorded value that is not one plain URL or text is not compared", () => {
    const run = { ...RUN, nodeStates: { note: { status: "completed", fromSavedData: true, output: { text: "a", json: { x: 1 } } } } }
    expect(feederReadsTheSame(run, n("note", "text-prompt", { text: "a" }), undefined)).toBe(false)
  })
})

describe("continueFromFor", () => {
  const nodes = [n("rec", "upload-video", { url: "https://cdn/rec.mp4" }), n("plan", "edit-plan", { generatedJson: PLAN, resultsRunId: "exec-prev" }), n("cut", "apply-edl"), n("cap", "add-captions")]
  const edges = [e("rec", "cut", undefined, "sources"), e("plan", "cut", undefined, "edl"), e("cut", "cap")]
  const runSet = new Set(["cut", "cap"])

  it("every feeder reads the same: continues the run", () => {
    expect(continueFromFor(RUN, runSet, nodes, edges)).toBe("exec-prev")
  })

  it("one feeder differs: a plain run", () => {
    const changed = nodes.map((x) => (x.id === "rec" ? n("rec", "upload-video", { url: "https://cdn/new.mp4" }) : x))
    expect(continueFromFor(RUN, runSet, changed, edges)).toBeUndefined()
  })

  it("a run the server named is continued whatever the canvas shows", () => {
    const changed = nodes.map((x) => (x.id === "rec" ? n("rec", "upload-video", { url: "https://cdn/new.mp4" }) : x))
    expect(continueFromFor({ ...RUN, named: true }, runSet, changed, edges)).toBe("exec-prev")
  })

  it("no run: a plain run", () => {
    expect(continueFromFor(null, runSet, nodes, edges)).toBeUndefined()
  })

  it("Edit Plan → render: the final still continues the run when the plan holds a review (regression)", () => {
    const reviewed = nodes.map((x) => (x.id === "plan" ? n("plan", "edit-plan", { generatedJson: PLAN_REORDERED, editedEdl: { segments: [] }, resultsRunId: "exec-prev" }) : x))
    expect(continueFromFor(RUN, runSet, reviewed, edges)).toBe("exec-prev")
  })

  it("a take of a feeder deleted since the run: a plain run", () => {
    const withImage = [...nodes, n("img", "generate-image", { generatedResults: [{ url: "https://cdn/a.png" }], resultsRunId: "exec-prev" })]
    expect(continueFromFor(RUN, runSet, withImage, [...edges, e("img", "cap")])).toBeUndefined()
  })

  it("a text mapped into the run set with no wire left, edited since the run: a plain run", () => {
    const cap = n("cap", "add-captions", { fieldMappings: { prompt: { sourceNodeId: "llm" } } })
    const graph = (text: string) => [...nodes.filter((x) => x.id !== "cap"), cap, n("llm", "llm-chat", { generatedText: text, resultsRunId: "exec-prev" })]
    expect(continueFromFor(RUN, runSet, graph("Old caption"), edges)).toBe("exec-prev")
    expect(continueFromFor(RUN, runSet, graph("New caption"), edges)).toBeUndefined()
  })

  it("a parameter picker read only by a mapping is not compared (the server reads its data both ways)", () => {
    const cap = n("cap", "add-captions", { fieldMappings: { prompt: { sourceNodeId: "mood" } } })
    const graph = [...nodes.filter((x) => x.id !== "cap"), cap, n("mood", "mood", { mood: "calm" })]
    expect(continueFromFor(RUN, runSet, graph, edges)).toBe("exec-prev")
  })

  it("a Group in the run set reads its members: a member edited since makes it plain", () => {
    const group = n("grp", "group")
    const member = (text: string) => ({ ...n("llm", "llm-chat", { generatedText: text, resultsRunId: "exec-prev" }), parentId: "grp" }) as unknown as WorkflowNode
    const set = new Set([...runSet, "grp"])
    expect(continueFromFor(RUN, set, [...nodes, group, member("Old caption")], edges)).toBe("exec-prev")
    expect(continueFromFor(RUN, set, [...nodes, group, member("New caption")], edges)).toBeUndefined()
  })

  it("a feeder behind a Teleport pair is read at its origin, and still continues", () => {
    const tp = [...nodes, n("tx", "teleport-send"), n("rx", "teleport-receive")]
    const wires = [
      e("rec", "tx"),
      { ...e("tx", "rx"), data: { teleporter: true } } as unknown as WorkflowEdge,
      e("rx", "cut", undefined, "sources"),
      e("plan", "cut", undefined, "edl"),
      e("cut", "cap"),
    ]
    expect(continueFromFor(RUN, runSet, tp, wires)).toBe("exec-prev")
  })
})

describe("feederReads", () => {
  it("covers every feeder the run set counts (buildFeedMaps): wires, Group members and mappings", () => {
    const graph = [
      n("a", "text-prompt"),
      n("b", "llm-chat"),
      { ...n("c", "generate-image"), parentId: "grp" } as unknown as WorkflowNode,
      n("grp", "group"),
      n("cut", "apply-edl", { fieldMappings: { prompt: { sourceNodeId: "b" } } }),
    ]
    const set = new Set(["cut", "grp"])
    const wires = [e("a", "cut")]
    const { parents } = buildFeedMaps(graph as unknown as readonly FeedNode[], wires)
    const counted = new Set([...set].flatMap((id) => parents.get(id) ?? []).filter((id) => !set.has(id)))
    expect(new Set(feederReads(set, graph, wires).map((r) => r.source))).toEqual(counted)
  })
})

/**
 * Fix round 2 (N1, N2): the recorded read follows the HANDLE, the way the
 * server's `getPrimaryOutput` reads it. A JSON pip is compared as JSON (key
 * order ignored, jsonb does not keep it), whatever its preview kind. The canvas
 * side of every fixture below is built by the code that lands a server run on
 * the node (`jsonRunResultPatch`), never by hand, so the two shapes are the
 * real ones.
 */
describe("a JSON pip is read the way the server reads it", () => {
  /** A Transcribe's Transcript as the run recorded it. */
  const TRANSCRIPT = { version: 1, language: "en", words: [{ text: "Hello", start: 0, end: 0.4 }, { text: "there", start: 0.5, end: 0.9 }] }
  /** The same Transcript back from jsonb: keys in another order. */
  const TRANSCRIPT_REORDERED = { words: [{ end: 0.4, start: 0, text: "Hello" }, { end: 0.9, start: 0.5, text: "there" }], language: "en", version: 1 }
  const TEXT = "Hello there"
  /** A node as a landed server run leaves it: the result patch, then the run's stamp. */
  const landed = (id: string, type: string, output: Record<string, unknown>, stamp: string, base: Record<string, unknown> = {}) => {
    const patch = jsonRunResultPatch(type, output, { jobId: `job-${stamp}`, data: base })
    expect(patch).toBeDefined()
    return n(id, type, { ...base, ...patch, resultsRunId: stamp })
  }
  const ranIt = (id: string, output: Record<string, unknown>): ContinuableRun => ({
    id: "exec-prev",
    named: false,
    nodeStates: { [id]: { status: "completed", startedAt: "t", jobId: "j", output } },
  })

  describe("Transcribe json into the Apply EDL's Transcript (the captioned layout)", () => {
    const rec = n("rec", "upload-video", { url: "https://cdn/rec.mp4" })
    const plan = n("plan", "edit-plan", { generatedJson: PLAN, resultsRunId: "exec-prev" })
    const edges = [e("rec", "cut", undefined, "sources"), e("plan", "cut", undefined, "edl"), e("tr", "cut", "json", "transcript"), e("cut", "cap")]
    const runSet = new Set(["cut", "cap"])
    const graph = (tr: WorkflowNode) => [rec, plan, tr, n("cut", "apply-edl"), n("cap", "add-captions")]
    /** The run's states: the transcript recorded with its keys reordered, as jsonb hands it back. */
    const run: ContinuableRun = { ...RUN, nodeStates: { ...RUN.nodeStates, tr: { status: "completed", startedAt: "t", jobId: "j", output: { text: TEXT, json: TRANSCRIPT_REORDERED } } } }

    it("an unchanged transcript continues the run", () => {
      const tr = landed("tr", "transcribe", { text: TEXT, json: TRANSCRIPT }, "exec-prev")
      expect(feederReadsTheSame(run, tr, "json")).toBe(true)
      expect(continueFromFor(run, runSet, graph(tr), edges)).toBe("exec-prev")
    })

    it("a transcript edited since, the stamp unchanged: a plain run", () => {
      const tr = landed("tr", "transcribe", { text: TEXT, json: { ...TRANSCRIPT, words: [TRANSCRIPT.words[0]] } }, "exec-prev")
      expect(feederReadsTheSame(run, tr, "json")).toBe(false)
      expect(continueFromFor(run, runSet, graph(tr), edges)).toBeUndefined()
    })

    it("re-run since (another take on show): a plain run", () => {
      const tr = landed("tr", "transcribe", { text: "Hi there", json: { ...TRANSCRIPT, language: "fr" } }, "job-9")
      expect(continueFromFor(run, runSet, graph(tr), edges)).toBeUndefined()
    })

    it("handed on from an earlier run (a continuation seeded it): continues when the canvas shows that run's transcript", () => {
      const seeded: ContinuableRun = { ...run, nodeStates: { ...run.nodeStates, tr: { status: "completed", seededFromExecution: "exec-failed", output: { text: TEXT, json: TRANSCRIPT_REORDERED } } } }
      expect(feederReadsTheSame(seeded, landed("tr", "transcribe", { text: TEXT, json: TRANSCRIPT }, "exec-failed"), "json")).toBe(true)
      expect(feederReadsTheSame(seeded, landed("tr", "transcribe", { text: TEXT, json: { ...TRANSCRIPT, language: "de" } }, "exec-failed"), "json")).toBe(false)
    })

    it("read from the node's saved data (a Run from here left it out): compared as JSON too", () => {
      const saved: ContinuableRun = { ...RUN, nodeStates: { tr: { status: "completed", fromSavedData: true, output: { text: TEXT, json: TRANSCRIPT_REORDERED } } } }
      expect(feederReadsTheSame(saved, landed("tr", "transcribe", { text: TEXT, json: TRANSCRIPT }, "exec-older"), "json")).toBe(true)
      expect(feederReadsTheSame(saved, landed("tr", "transcribe", { text: TEXT, json: { ...TRANSCRIPT, words: [] } }, "exec-older"), "json")).toBe(false)
    })

    it("its text pip is still compared as text", () => {
      const tr = landed("tr", "transcribe", { text: TEXT, json: TRANSCRIPT }, "exec-prev")
      expect(feederReadsTheSame(run, tr, "text")).toBe(true)
      expect(feederReadsTheSame(run, landed("tr", "transcribe", { text: "Other words", json: TRANSCRIPT }, "exec-prev"), "text")).toBe(false)
    })
  })

  it("Silence Detect's ranges (another JSON pip): unchanged continues, changed is plain", () => {
    const RANGES = { version: 1, durationMs: 9000, ranges: [{ startMs: 1000, endMs: 2500 }] }
    const run = ranIt("sd", { json: { ranges: [{ endMs: 2500, startMs: 1000 }], durationMs: 9000, version: 1 } })
    expect(feederReadsTheSame(run, landed("sd", "silence-detect", { json: RANGES }, "exec-prev"), "json")).toBe(true)
    expect(feederReadsTheSame(run, landed("sd", "silence-detect", { json: { ...RANGES, ranges: [] } }, "exec-prev"), "json")).toBe(false)
  })

  it("N2: a data pip with a take history (Text to Dialogue) fails once the run's take is deleted, whatever the stamp says", () => {
    const A = { version: 1, words: [{ text: "A", start: 0, end: 1 }] }
    const B = { version: 1, words: [{ text: "B", start: 0, end: 1 }] }
    const run = ranIt("dlg", { audioUrl: "https://cdn/b.mp3", json: B })
    // Take A from an earlier run, then the run's take B on top.
    const withA = landed("dlg", "text-to-dialogue", { audioUrl: "https://cdn/a.mp3", json: A }, "exec-old")
    const withBoth = landed("dlg", "text-to-dialogue", { audioUrl: "https://cdn/b.mp3", json: B }, "exec-prev", withA.data as Record<string, unknown>)
    expect((withBoth.data as { generatedResults: unknown[] }).generatedResults).toHaveLength(2)
    // Take B deleted: A is the one take left, the stamp still the run's.
    const results = (withBoth.data as { generatedResults: unknown[] }).generatedResults
    const deletedB = n("dlg", "text-to-dialogue", { ...withBoth.data, generatedResults: results.slice(1), activeResultIndex: 0, generatedJson: A })
    expect(feederReadsTheSame(run, deletedB, "json")).toBe(false)
    // Only the run's take: the same.
    expect(feederReadsTheSame(run, landed("dlg", "text-to-dialogue", { audioUrl: "https://cdn/b.mp3", json: B }, "exec-prev"), "json")).toBe(true)
  })

  it("a data pip the run recorded no JSON for (a plan marker) is left to the stamp", () => {
    expect(feederReadsTheSame(RUN, n("plan", "edit-plan", { generatedJson: PLAN, resultsRunId: "exec-prev" }), undefined)).toBe(true)
  })

  it("recordedJsonOf follows the handle as getPrimaryOutput does", () => {
    const pair = { edl: { segments: [1] }, transcript: { words: [2] } }
    expect(recordedJsonOf("camera-switch", "transcript", { json: pair })).toEqual(pair.transcript)
    expect(recordedJsonOf("camera-switch", "edl", { json: pair })).toEqual(pair.edl)
    expect(recordedJsonOf("forced-alignment", undefined, { alignment: { a: 1 } })).toEqual({ a: 1 })
    expect(recordedJsonOf("apply-edl", "json", { json: { t: 1 }, videoUrl: "v.mp4" })).toEqual({ t: 1 })
    // A render's media pip carries no JSON.
    expect(recordedJsonOf("apply-edl", undefined, { json: { t: 1 }, videoUrl: "v.mp4" })).toBeUndefined()
    expect(recordedJsonOf("transcribe", "json", { json: { w: 1 }, text: "x" })).toEqual({ w: 1 })
  })

  it("Camera Switch's transcript pip is compared with the transcript half of its pair", () => {
    const pair = { edl: { segments: [{ start: 0, end: 1 }] }, transcript: { words: [{ text: "x" }] } }
    const run = ranIt("cs", { json: pair })
    const cs = (generatedJson: unknown) => n("cs", "camera-switch", { generatedJson, resultsRunId: "exec-prev" })
    expect(feederReadsTheSame(run, cs(pair), "transcript")).toBe(true)
    expect(feederReadsTheSame(run, cs(pair), "edl")).toBe(true)
    expect(feederReadsTheSame(run, cs({ ...pair, transcript: { words: [] } }), "transcript")).toBe(false)
  })
})
