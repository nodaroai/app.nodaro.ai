/**
 * A selected Apply EDL take on the SERVER — the half of the engine-split check
 * that runs here (A1-0).
 *
 * The bug: the config-panel results gallery treated Apply EDL as an image, so
 * picking an older take wrote `generatedImageUrl`. The canvas then used the
 * picked take (it reads the active result first), while a workflow run read the
 * newest one (this engine reads `generatedVideoUrl` first) — and the pick was
 * saved, so the two kept disagreeing. A workflow run that landed an audio take
 * on a node still holding an earlier video render's URL split them the same
 * way with no pick at all.
 *
 * `fixtures/apply-edl-picked-take.json` holds the node data the editor saves
 * after a pick (`cases`) and after a workflow run (`runs`). The frontend tests
 * click the real gallery or run the real run-result lane and require the
 * result to equal that `after` data; this file runs the orchestrator's
 * saved-data path on the same data. Together they require both engines to hand
 * the selected take downstream, as the right medium, with its own Transcript —
 * or with none when the editor cannot know that take's (`cases.cleared`), never
 * another take's.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { extractSavedNodeOutput } from "../output-extractor.js"
import { resolveNodeInputs } from "../input-resolver.js"
import { seededFromSavedData } from "../saved-data.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

interface Consumer {
  readonly id: string
  readonly type: string
  readonly targetHandle: string
  readonly receives: "videoUrl" | "audioUrl"
  /** The consumer's json input wired to Apply EDL's Transcript output, if any. */
  readonly transcriptHandle?: string
}

interface PickCase {
  readonly consumer: Consumer
  readonly pickIndex: number
  readonly before: SimpleNode
  readonly after: SimpleNode
}

interface RunCase {
  readonly consumer: Consumer
  readonly before: SimpleNode
  readonly after: SimpleNode
}

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(readFileSync(join(HERE, "fixtures", "apply-edl-picked-take.json"), "utf8")) as {
  cases: Record<"video" | "audio" | "fetched" | "cleared", PickCase>
  runs: Record<"audio" | "video" | "untranscribed", RunCase>
}

const selectedTake = (node: SimpleNode): { url: string; generatedJson?: unknown } =>
  (node.data.generatedResults as Array<{ url: string; generatedJson?: unknown }>)[node.data.activeResultIndex as number]

/** The consumer's inputs on a run that does not re-run Apply EDL ("Run from
 *  here" on the consumer): the orchestrator seeds the out-of-subset node from
 *  its saved data exactly like this (orchestrator-worker.ts, seededFromSavedData
 *  over extractSavedNodeOutput). */
function consumerInputsOnServer(applyEdl: SimpleNode, spec: Consumer): Record<string, unknown> {
  const consumer: SimpleNode = { id: spec.id, type: spec.type, data: {} }
  const edges: SimpleEdge[] = [
    { id: "e-media", source: applyEdl.id, sourceHandle: "media", target: consumer.id, targetHandle: spec.targetHandle },
    ...(spec.transcriptHandle
      ? [{ id: "e-json", source: applyEdl.id, sourceHandle: "json", target: consumer.id, targetHandle: spec.transcriptHandle }]
      : []),
  ]
  const nodeStates: Record<string, NodeExecutionState> = {
    [applyEdl.id]: seededFromSavedData(extractSavedNodeOutput(applyEdl)),
  }
  return resolveNodeInputs(consumer, edges, nodeStates, [applyEdl, consumer]) as unknown as Record<string, unknown>
}

describe("a picked Apply EDL take on the server (A1-0)", () => {
  it("video output: the saved output is the picked take with its own Transcript, and the next node receives both", () => {
    const c = FIXTURE.cases.video
    expect(c.after.data.activeResultIndex).toBe(c.pickIndex)
    const take = selectedTake(c.after)
    expect(take.generatedJson).toBeDefined()

    const saved = extractSavedNodeOutput(c.after)
    expect(saved?.videoUrl).toBe(take.url)
    expect(saved?.audioUrl).toBeUndefined()
    expect(saved?.json).toEqual(take.generatedJson)

    const inputs = consumerInputsOnServer(c.after, c.consumer)
    expect(c.consumer.receives).toBe("videoUrl")
    expect(inputs.videoUrl).toBe(take.url)
    // The captions are timed to the cut they burn into, not to the newest one.
    expect(c.consumer.transcriptHandle).toBe("transcript")
    expect(inputs.transcript).toBe(JSON.stringify(take.generatedJson))
  })

  it("audio output: the picked take wins over an earlier video render's URL, and arrives as audio", () => {
    const c = FIXTURE.cases.audio
    expect(c.after.data.activeResultIndex).toBe(c.pickIndex)
    const picked = selectedTake(c.after).url

    const saved = extractSavedNodeOutput(c.after)
    expect(saved?.audioUrl).toBe(picked)
    expect(saved?.videoUrl).toBeUndefined()

    const inputs = consumerInputsOnServer(c.after, c.consumer)
    expect(c.consumer.receives).toBe("audioUrl")
    expect(inputs.audioUrl).toBe(picked)
    expect(inputs.videoUrl).toBeUndefined()
  })
})

describe("a picked take that kept no Transcript of its own, on the server (decided 2026-10-04)", () => {
  it("its Transcript read back from its own job: the next node receives the picked take with that Transcript", () => {
    const c = FIXTURE.cases.fetched
    expect(c.after.data.activeResultIndex).toBe(c.pickIndex)
    const take = selectedTake(c.after)
    expect(take.generatedJson).toBeUndefined()
    expect(c.after.data.generatedJson).toBeDefined()
    expect(c.after.data.generatedJson).not.toEqual(c.before.data.generatedJson)

    const saved = extractSavedNodeOutput(c.after)
    expect(saved?.videoUrl).toBe(take.url)
    expect(saved?.json).toEqual(c.after.data.generatedJson)

    const inputs = consumerInputsOnServer(c.after, c.consumer)
    expect(inputs.videoUrl).toBe(take.url)
    expect(inputs.transcript).toBe(JSON.stringify(c.after.data.generatedJson))
  })

  it("its job not provably its own: the next node receives the picked take and NO Transcript, never another take's", () => {
    const c = FIXTURE.cases.cleared
    expect(c.after.data.activeResultIndex).toBe(c.pickIndex)
    const take = selectedTake(c.after)
    // Before the pick the node held take 2's Transcript.
    expect(c.before.data.generatedJson).toBeDefined()
    expect(c.after.data).not.toHaveProperty("generatedJson")

    const saved = extractSavedNodeOutput(c.after)
    expect(saved?.videoUrl).toBe(take.url)
    expect(saved?.json).toBeUndefined()

    const inputs = consumerInputsOnServer(c.after, c.consumer)
    expect(inputs.videoUrl).toBe(take.url)
    expect(inputs.transcript).toBeUndefined()
  })
})

describe("an Apply EDL take landed by a workflow run, with no pick (A1-0)", () => {
  it("audio output: the newest take arrives as audio, not the earlier video render still on the node before the run", () => {
    const c = FIXTURE.runs.audio
    const newest = selectedTake(c.after).url
    expect(c.after.data.activeResultIndex).toBe(0)

    const saved = extractSavedNodeOutput(c.after)
    expect(saved?.audioUrl).toBe(newest)
    expect(saved?.videoUrl).toBeUndefined()

    const inputs = consumerInputsOnServer(c.after, c.consumer)
    expect(c.consumer.receives).toBe("audioUrl")
    expect(inputs.audioUrl).toBe(newest)
    expect(inputs.videoUrl).toBeUndefined()
  })

  it("a render cut with a transcript: the newest take arrives with ITS Transcript, not the one an earlier take left", () => {
    const c = FIXTURE.runs.video
    const newest = selectedTake(c.after)
    expect(c.after.data.activeResultIndex).toBe(0)
    expect(newest.generatedJson).toBeDefined()
    expect(newest.generatedJson).not.toEqual(c.before.data.generatedJson)

    const saved = extractSavedNodeOutput(c.after)
    expect(saved?.videoUrl).toBe(newest.url)
    expect(saved?.json).toEqual(newest.generatedJson)

    const inputs = consumerInputsOnServer(c.after, c.consumer)
    expect(inputs.videoUrl).toBe(newest.url)
    expect(inputs.transcript).toBe(JSON.stringify(newest.generatedJson))
  })

  it("a render cut with NO transcript: the newest take arrives with none, never the one an earlier take left", () => {
    const c = FIXTURE.runs.untranscribed
    const newest = selectedTake(c.after)
    expect(c.before.data.generatedJson).toBeDefined()
    expect(c.after.data).not.toHaveProperty("generatedJson")

    const saved = extractSavedNodeOutput(c.after)
    expect(saved?.videoUrl).toBe(newest.url)
    expect(saved?.json).toBeUndefined()

    const inputs = consumerInputsOnServer(c.after, c.consumer)
    expect(inputs.videoUrl).toBe(newest.url)
    expect(inputs.transcript).toBeUndefined()
  })
})
