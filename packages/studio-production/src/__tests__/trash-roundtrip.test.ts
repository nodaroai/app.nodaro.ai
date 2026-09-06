import { describe, it, expect } from "vitest"

import { parseProduction, serializeProduction } from "../shot-graph"
import { buildClip } from "../shot"
import type { Shot, ShotClipResult } from "../shot"
import type {
  TrashedClip,
  TrashedItem,
  TrashedShot,
  TrashedStill,
} from "../trash"

/**
 * The clip bin has to survive a reload, which in this app means surviving
 * `serializeProduction` → `parseProduction`. The trap this pins: a field written
 * into `settings.studio` but NOT read back by the parser is ERASED on the very
 * next save — the bin would look fine until the first autosave after a reload,
 * then quietly empty itself.
 *
 * It also pins that a trashed result keeps the SAME fidelity as a live clip result
 * (both go through one wire mapper), because a restored clip has to be
 * re-selectable: its prompt, model, duration and source frames are what the
 * composer restores from.
 */

const RESULT: ShotClipResult = {
  url: "https://cdn/deleted.mp4",
  jobId: "job-9",
  prompt: "a slow dolly in",
  provider: "seedance-2",
  duration: 8,
  startFrameUrl: "https://cdn/start.png",
  endFrameUrl: "https://cdn/end.png",
  referenceImageUrls: ["https://cdn/ref1.png"],
  referenceVideoUrls: ["https://cdn/ref.mp4"],
  referenceAudioUrls: ["https://cdn/ref.mp3"],
  freecutProjectUrl: "https://cdn/project.json",
  scenePrompt: "A rain-soaked rooftop chase.",
}

const SHOT: Shot = {
  id: "s1",
  scenePrompt: "A rain-soaked rooftop chase.",
  still: {
    nodeId: "img-1",
    url: "https://cdn/still.png",
    provider: "gpt-image-2",
    prompt: "a still",
  },
  clip: buildClip(
    { nodeId: "vid-1", provider: "seedance-2" },
    [{ url: "https://cdn/kept.mp4" }],
    0,
  ),
}

const ENTRY: TrashedClip = {
  kind: "clip",
  id: "trash-1",
  shotId: "s1",
  shotName: "Rooftop chase",
  index: 2,
  deletedAt: "2026-07-30T10:00:00.000Z",
  clipBase: { nodeId: "vid-1", provider: "seedance-2", prompt: "clip prompt" },
  result: RESULT,
}

/** Serialize → the `Workflow` shape the loader hands back → parse. */
function roundTrip(trash: ReadonlyArray<TrashedItem>) {
  const graph = serializeProduction([SHOT], "s1", undefined, undefined, undefined, undefined, undefined, trash)
  return parseProduction({
    id: "wf-1",
    nodes: graph.nodes,
    edges: graph.edges,
    settings: graph.settings,
  } as unknown as Parameters<typeof parseProduction>[0])
}

/** A trashed SHOT, stored the way the store stores one: as a mini-graph. */
const SHOT_ENTRY: TrashedShot = {
  kind: "shot",
  id: "trash-shot-1",
  shotId: "s1",
  shotName: "Rooftop chase",
  index: 0,
  deletedAt: "2026-07-30T11:00:00.000Z",
  graph: serializeProduction([SHOT], "s1"),
}

describe("trash round-trip", () => {
  it("survives serialize → parse with every restore field intact", () => {
    const parsed = roundTrip([ENTRY])
    expect(parsed.trash).toEqual([ENTRY])
  })

  it("survives a SECOND save (the erase-on-next-save trap)", () => {
    // Reload, then autosave, then reload again: a write-only field vanishes here.
    const once = roundTrip([ENTRY])
    const twice = roundTrip(once.trash!)
    expect(twice.trash).toEqual([ENTRY])
  })

  it("writes nothing when the bin is empty (an untouched production stays identical)", () => {
    const withEmpty = serializeProduction([SHOT], "s1", undefined, undefined, undefined, undefined, undefined, [])
    const withNone = serializeProduction([SHOT], "s1")
    expect(withEmpty).toEqual(withNone)
    expect(
      (withEmpty.settings.studio as { trash?: unknown }).trash,
    ).toBeUndefined()
    expect(roundTrip([]).trash).toBeUndefined()
  })

  it("does not disturb the shots it rides alongside", () => {
    const parsed = roundTrip([ENTRY])
    expect(parsed.shots).toHaveLength(1)
    expect(parsed.shots[0]!.clip!.url).toBe("https://cdn/kept.mp4")
    expect(parsed.shots[0]!.still!.url).toBe("https://cdn/still.png")
  })

  it("a trashed SHOT survives, and its graph still parses back into the shot", () => {
    const parsed = roundTrip([SHOT_ENTRY])
    expect(parsed.trash).toEqual([SHOT_ENTRY])

    // The stored graph is still a valid one-shot production — the restore path.
    const entry = parsed.trash![0] as TrashedShot
    const restored = parseProduction({
      id: "s1",
      nodes: entry.graph.nodes,
      edges: entry.graph.edges,
      settings: entry.graph.settings,
    } as unknown as Parameters<typeof parseProduction>[0])
    expect(restored.shots).toHaveLength(1)
    expect(restored.shots[0]!.id).toBe("s1")
    expect(restored.shots[0]!.clip!.url).toBe("https://cdn/kept.mp4")
    // The scene's generic prompt rides the mini-graph like every other
    // authoring field: a restore that lost it would hand back a scene whose
    // takes carry a description the scene no longer says.
    expect(restored.shots[0]!.scenePrompt).toBe("A rain-soaked rooftop chase.")
  })

  it("reads a pre-`kind` entry as a clip (entries written before shots were binnable)", () => {
    const graph = serializeProduction([SHOT], "s1", undefined, undefined, undefined, undefined, undefined, [ENTRY])
    const studio = graph.settings.studio as unknown as Record<string, unknown>
    const written = (studio.trash as Record<string, unknown>[])[0]!
    delete written.kind // what the first shipped version wrote

    const parsed = parseProduction({
      id: "wf-1",
      nodes: graph.nodes,
      edges: graph.edges,
      settings: graph.settings,
    } as unknown as Parameters<typeof parseProduction>[0])

    expect(parsed.trash).toEqual([ENTRY])
  })

  /**
   * The base's CINEMATIC channel. `trashItemToWire` spreads `stillBase` /
   * `clipBase` whole, but `readTrash` reconstructs each one field-by-field — so
   * `direction` / `subject` had no reader and were dropped on the way back.
   * Restoring the LAST-deleted still/clip would then rebuild the node with its
   * prose but none of the catalog ids that produced it (and the next debounced
   * save would persist the loss).
   */
  it("keeps the still base's direction/subject through a restore reload", () => {
    const entry: TrashedStill = {
      kind: "still",
      id: "trash-still-d",
      shotId: "s1",
      index: 0,
      deletedAt: "2026-08-30T10:00:00.000Z",
      stillBase: {
        nodeId: "img-1",
        provider: "gpt-image-2",
        prompt: "a rooftop at dusk",
        direction: { shotSize: "wide-shot", atmosphere: ["fog", "haze"] },
        subject: { age: "age-30s", ethnicity: ["eth-a", "eth-b"] },
      },
      result: { url: "https://cdn/deleted.png", jobId: "job-d" },
    }
    expect(roundTrip([entry]).trash).toEqual([entry])
    // …and a SECOND save, which is where a write-without-reader shows up.
    expect(roundTrip(roundTrip([entry]).trash!).trash).toEqual([entry])
  })

  it("keeps the clip base's direction/subject through a restore reload", () => {
    const entry: TrashedClip = {
      ...ENTRY,
      id: "trash-clip-d",
      clipBase: {
        nodeId: "vid-1",
        provider: "seedance-2",
        prompt: "a slow dolly in",
        direction: { cameraMotion: "dolly-in", mood: ["tense"] },
        subject: { age: "age-40s" },
      },
    }
    expect(roundTrip([entry]).trash).toEqual([entry])
    expect(roundTrip(roundTrip([entry]).trash!).trash).toEqual([entry])
  })

  it("drops an entry that could never be restored rather than listing it", () => {
    const graph = serializeProduction([SHOT], "s1", undefined, undefined, undefined, undefined, undefined, [ENTRY])
    const studio = graph.settings.studio as unknown as Record<string, unknown>
    // Corrupt the stored entries the way a bad write or hand-edit would.
    studio.trash = [
      { id: "no-shot", clipBase: { nodeId: "v" }, result: { url: "https://cdn/a.mp4" } }, // no shotId
      { id: "no-node", shotId: "s1", result: { url: "https://cdn/b.mp4" } }, // no clipBase
      { id: "no-url", shotId: "s1", clipBase: { nodeId: "v" }, result: {} }, // unusable result
      { id: "ok", shotId: "s1", clipBase: { nodeId: "v" }, result: { url: "https://cdn/c.mp4" } },
    ]
    const parsed = parseProduction({
      id: "wf-1",
      nodes: graph.nodes,
      edges: graph.edges,
      settings: graph.settings,
    } as unknown as Parameters<typeof parseProduction>[0])

    expect(parsed.trash?.map((t) => t.id)).toEqual(["ok"])
  })
})
