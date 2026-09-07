/**
 * The `stills` section — its shape, `add_still_result` (with start-frame
 * stickiness and INV-D) and the section's schemas.
 *
 * One of three siblings carrying the ported still suite; the harness, and the
 * doc comment that explains the port, live in
 * `./helpers/stills-fixtures.ts`. The assertions here are untouched.
 */

import { describe, expect, it } from "vitest"
import {
  ATMOSPHERES,
  CAMERA_MOTIONS,
  DIRECTION_KEYS,
  FRAMINGS,
  getAtmospherePromptHint,
  getCameraMotionPromptHint,
  getFramingPromptHint,
} from "@nodaro/prompts"

import { directionWireFields } from "../../direction"
import { CAMERA_MOVEMENT_KEY } from "../../look-pickers"
import type { LookSelectionMap, ShotStillResult } from "../../shot"
import { stillResults } from "../../shot"
import { serializeProduction } from "../../shot-graph"
import { OpError } from "../errors"
import type { Production } from "../production"
import { stillsHandlers, stillsOpClasses, stillsOpSchemas } from "../sections/stills"

import {
  addStill,
  empty,
  keyAt,
  renameStill,
  resetCtx,
  setActive,
  stillAndClip,
  stillOnly,
  withStartFrame,
} from "./helpers/stills-fixtures"

// ── the section's own shape ─────────────────────────────────────────────────

describe("the stills section", () => {
  it("declares a schema, a handler and a class for the same four ops", () => {
    const ops = ["add_still_result", "set_active_still", "remove_still_result", "rename_still_result"]
    expect(Object.keys(stillsOpSchemas)).toEqual(ops)
    expect(Object.keys(stillsHandlers)).toEqual(ops)
    expect(Object.keys(stillsOpClasses)).toEqual(ops)
    // Only the deletion is a `D` — the rest are safe.
    expect(stillsOpClasses.remove_still_result).toBe("D")
    expect(stillsOpClasses.add_still_result).toBe("S")
  })
})

// ── addShotStillResult (production-store.test.ts L338) ──────────────────────

describe("add_still_result", () => {
  const result = (url: string): ShotStillResult => ({
    url,
    provider: "flux-2-max",
    prompt: "reframed",
  })

  it("creates the still on the first result (minimal single shape, no results list)", () => {
    const id = "s1"
    const p = addStill(empty(id), id, result("https://r2.example/1.png")).production
    const still = p.shots[0].still
    expect(still?.url).toBe("https://r2.example/1.png")
    expect(still?.nodeId).toBe(`generate-image-${id}`)
    expect(still?.results).toBeUndefined() // a lone result stays minimal
  })

  it("carries the prompt-format marker + look ids onto the result", () => {
    // Every optional result field must be copied by the handler's explicit list,
    // or it is silently erased before it ever reaches the graph (the readVoice
    // lesson, write-side edition) — and a dropped marker degrades a structured
    // result to legacy, which then gags the pickers on restore.
    const id = "s1"
    const look = { framingId: "medium-shot", atmosphereId: ["fog"] }
    const p = addStill(empty(id), id, {
      ...result("https://r2.example/1.png"),
      promptFormat: 2,
      look,
    }).production
    const [r] = stillResults(p.shots[0].still!)
    expect(r.promptFormat).toBe(2)
    expect(r.look).toEqual(look)
  })

  it("a RENAME does not drop the marker (the rebuild goes through buildStill)", () => {
    const id = "s1"
    const look = { framingId: "medium-shot" }
    let p = addStill(empty(id), id, {
      ...result("https://r2.example/1.png"),
      promptFormat: 2,
      look,
    }).production
    p = renameStill(p, id, keyAt(p, 0, 0), "Hero astronaut").production
    const [r] = stillResults(p.shots[0].still!)
    expect(r.name).toBe("Hero astronaut")
    expect(r.promptFormat).toBe(2)
    expect(r.look).toEqual(look)
  })

  it("never writes an EMPTY look (an armed selection of nothing)", () => {
    const id = "s1"
    const p = addStill(empty(id), id, {
      ...result("https://r2.example/1.png"),
      promptFormat: 2,
      look: {},
    }).production
    expect(stillResults(p.shots[0].still!)[0]).not.toHaveProperty("look")
  })

  it("accumulates X images per shot — results grow, newest is active, node id stable", () => {
    const id = "s1"
    let p = addStill(empty(id), id, result("https://r2.example/1.png")).production
    const node1 = p.shots[0].still?.nodeId
    p = addStill(p, id, result("https://r2.example/2.png")).production
    p = addStill(p, id, result("https://r2.example/3.png")).production
    const still = p.shots[0].still
    expect(still?.results?.map((r) => r.url)).toEqual([
      "https://r2.example/1.png",
      "https://r2.example/2.png",
      "https://r2.example/3.png",
    ])
    expect(still?.activeIndex).toBe(2)
    expect(still?.url).toBe("https://r2.example/3.png") // newest is active
    expect(still?.nodeId).toBe(node1) // one node, results accumulate under it
  })

  it("atFront inserts as image #1 + active (the continuity opening), even after others exist", () => {
    const id = "s1"
    // The user generated two candidates FIRST ...
    let p = addStill(empty(id), id, result("https://r2.example/cand1.png")).production
    p = addStill(p, id, result("https://r2.example/cand2.png")).production
    // ... THEN continuity pins the previous frame — it must become image #1, not last.
    p = addStill(
      p,
      id,
      {
        ...result("https://r2.example/frame.png"),
        referenceImageUrls: ["https://r2.example/frame.png"],
      },
      true,
    ).production
    const still = p.shots[0].still
    expect(still?.results?.map((r) => r.url)).toEqual([
      "https://r2.example/frame.png", // image #1 — the opening
      "https://r2.example/cand1.png",
      "https://r2.example/cand2.png",
    ])
    expect(still?.activeIndex).toBe(0) // and it's the active/shown frame
    expect(still?.url).toBe("https://r2.example/frame.png")
  })

  it("carries referenceImageUrls onto the active result, omitting an empty/absent array", () => {
    const id = "s1"
    // A first generation WITHOUT refs (and one with an empty array) stays bare —
    // no stray key, matching the prompt/provider truthiness style. A later
    // generation WITH refs stores them on its result (for composer restore). Two
    // results so the per-result list survives (a lone result collapses to the
    // minimal legacy shape, which carries no per-result extras — by design).
    let p = addStill(empty(id), id, {
      ...result("https://r2.example/1.png"),
      referenceImageUrls: [],
    }).production
    p = addStill(p, id, {
      ...result("https://r2.example/2.png"),
      referenceImageUrls: ["https://r2.example/ref.png"],
    }).production
    const results = p.shots[0].still?.results
    expect(results?.[1].referenceImageUrls).toEqual([
      "https://r2.example/ref.png",
    ])
    expect(results?.[0]).not.toHaveProperty("referenceImageUrls")
  })

  it("KEEPS the clip on a new result + carries name/folder/end-frame", () => {
    const production: Production = {
      shots: [
        {
          ...stillAndClip("a"),
          name: "Opening wide",
          folderId: "f1",
          endFrame: "https://r2.example/end.png",
        },
      ],
    }
    const p = addStill(production, "a", result("https://r2.example/new.png")).production
    const shot = p.shots[0]
    // Re-framing must NOT destroy the video side: each clip result is self-
    // contained (it remembers its own source frames), so the clip survives a
    // new frame and the next animate APPENDS to its history.
    expect(shot.clip?.url).toBe("https://r2.example/a.mp4")
    expect(shot.still?.url).toBe("https://r2.example/new.png")
    // The prior frame is preserved as the first result (X images per shot).
    expect(shot.still?.results?.[0].url).toBe("https://r2.example/a.png")
    expect(shot.name).toBe("Opening wide")
    expect(shot.folderId).toBe("f1")
    expect(shot.endFrame).toBe("https://r2.example/end.png")
  })

  it("a new result preserves the clip's accumulated HISTORY (the interleave bug)", () => {
    const id = "s1"
    // The two animates are the `clips` section's ops — seeded here as the
    // document they leave behind, so this stays a stills test.
    let p = addStill(empty(id), id, result("https://r2.example/i1.png")).production
    p = {
      ...p,
      shots: p.shots.map((shot) => ({
        ...shot,
        clip: {
          nodeId: `generate-video-${id}`,
          url: "https://r2.example/v2.mp4",
          provider: "",
          prompt: "",
          results: [
            { url: "https://r2.example/v1.mp4" },
            { url: "https://r2.example/v2.mp4" },
          ],
          activeIndex: 1,
        },
      })),
    }
    // An image landing between animates (every candidate of a count>1 batch
    // does this) used to wipe the whole video history — the "I only ever see
    // my last video" bug.
    p = addStill(p, id, result("https://r2.example/i2.png")).production
    const clip = p.shots[0].clip
    expect(clip?.results?.map((r) => r.url)).toEqual([
      "https://r2.example/v1.mp4",
      "https://r2.example/v2.mp4",
    ])
    expect(clip?.activeIndex).toBe(1)
    expect(clip?.url).toBe("https://r2.example/v2.mp4")
  })

  it("returns a NEW production; REFUSES an unknown shot id", () => {
    const before: Production = { shots: [stillOnly("a")] }
    const after = addStill(before, "a", result("https://r2.example/new.png")).production
    expect(Object.is(before, after)).toBe(false)
    expect(before.shots[0].still?.url).toBe("https://r2.example/a.png") // copy-on-write

    // PORT NOTE: the reducer silently no-opped on an unknown shot; an operation
    // refuses instead (contract rule 5) — a caller that named the wrong shot
    // must hear about it, not watch the batch succeed having done nothing.
    expect(() => addStill(after, "nope", result("u"))).toThrow(OpError)
  })

  it("keeps name + aspectRatio/resolution/count on the stored result", () => {
    // Ported from production-store.import.test.ts — "the widened result carry".
    const production: Production = { shots: [stillOnly("a")] }
    const p = addStill(production, "a", {
      url: "https://r2.example/new.png",
      provider: "seedream",
      prompt: "wide hero",
      name: "Hero wide",
      aspectRatio: "21:9",
      resolution: "4K",
      count: 4,
    }).production
    const still = p.shots[0]!.still!
    const active = stillResults(still)[still.activeIndex ?? 0]!
    expect(active).toMatchObject({
      name: "Hero wide",
      aspectRatio: "21:9",
      resolution: "4K",
      count: 4,
    })
  })

  it("a landing still consumes the recipe's framing layer (directing + voice stay)", () => {
    // Ported from production-store.import.test.ts — "recipe consumption".
    const production: Production = {
      shots: [
        {
          id: "r1",
          recipe: {
            framing: { prompt: "a dune at dawn", provider: "nano-banana" },
            directing: { prompt: "wind ripples the sand", duration: 5 },
            voice: { text: "Dawn broke." },
          },
        },
      ],
    }
    const p = addStill(production, "r1", {
      url: "https://r2.example/dune.png",
      provider: "nano-banana",
      prompt: "a dune at dawn",
    }).production
    const shot = p.shots[0]!
    expect(shot.recipe?.framing).toBeUndefined()
    expect(shot.recipe?.directing?.prompt).toBe("wind ripples the sand")
    expect(shot.recipe?.voice?.text).toBe("Dawn broke.")
  })
})

// ── start frame stickiness #7 (production-store.test.ts L513) ───────────────

describe("start frame stickiness (#7)", () => {
  const result = (url: string): ShotStillResult => ({
    url,
    provider: "flux-2-max",
    prompt: "p",
  })

  it("anchors startFrame to the FIRST framing result (no longer shadows the still)", () => {
    const p = addStill(empty("s1"), "s1", result("https://r2/1.png")).production
    expect(p.shots[0].startFrame).toBe("https://r2/1.png")
  })

  it("does NOT move startFrame when SELECTING a different result (the invariant)", () => {
    let p = addStill(empty("s1"), "s1", result("https://r2/1.png")).production // sets startFrame = 1
    p = addStill(p, "s1", result("https://r2/2.png")).production // still already exists
    // A second generation does NOT move the (already-set) start frame…
    expect(p.shots[0].startFrame).toBe("https://r2/1.png")
    expect(p.shots[0].still?.url).toBe("https://r2/2.png") // …but the active still did
    // …and selecting result 0 changes the active still, NOT the start frame.
    p = setActive(p, "s1", keyAt(p, 0, 0)).production
    expect(p.shots[0].still?.url).toBe("https://r2/1.png")
    expect(p.shots[0].startFrame).toBe("https://r2/1.png")
  })

  it("re-anchors on a new generation only after the start frame was cleared", () => {
    let p = addStill(empty("s1"), "s1", result("https://r2/1.png")).production
    p = withStartFrame(p, undefined) // user clears it (the `frames` section's op)
    expect(p.shots[0].startFrame).toBeUndefined()
    p = addStill(p, "s1", result("https://r2/2.png")).production
    // With no explicit start frame, the next generation re-anchors it.
    expect(p.shots[0].startFrame).toBe("https://r2/2.png")
  })

  it("keeps an EXPLICIT start frame across a new generation (sticky)", () => {
    let p = addStill(empty("s1"), "s1", result("https://r2/1.png")).production
    p = withStartFrame(p, "https://r2/pinned.png") // explicit override
    p = addStill(p, "s1", result("https://r2/2.png")).production
    expect(p.shots[0].startFrame).toBe("https://r2/pinned.png")
  })
})

// ── INV-D (production-store.direction.test.ts L67) ──────────────────────────

// Real catalog ids — `directionWireFields` drops ids whose fragment renders
// empty, so a made-up id would project to nothing and test the empty case.
const framing = FRAMINGS.find(
  (f) => f.category === "shot-size" && getFramingPromptHint(f.id).length > 0,
)!
const atmosphere = ATMOSPHERES.find((a) => getAtmospherePromptHint(a.id).length > 0)!
const motion = CAMERA_MOTIONS.find(
  (m) => getCameraMotionPromptHint(m.id).length > 0,
)!

const LOOK: LookSelectionMap = {
  framingId: framing.id,
  atmosphereId: atmosphere.id,
}
const CLIP_LOOK: LookSelectionMap = { ...LOOK, [CAMERA_MOVEMENT_KEY]: motion.id }

// The same selection seen as its two LAYERS (D-A1): what the FILM strip held at
// submit and what this scene overrode. `{ ...FILM, ...SCENE }` is `LOOK` — the
// editor's own merge order, which is INV-A3.
const FILM: LookSelectionMap = { atmosphereId: atmosphere.id }
const SCENE: LookSelectionMap = { framingId: framing.id }

const IMAGE_WIRE = directionWireFields(LOOK, "image")!
void CLIP_LOOK // the clip half of the catalog fixture lives in the `clips` lane

describe("add_still_result — INV-D on the still", () => {
  it("stamps the projection of a promptFormat: 2 result, in PLATFORM keys", () => {
    const p = addStill({ shots: [{ id: "s1" }] }, "s1", {
      url: "https://r2.example/1.png",
      prompt: "a rooftop at dusk",
      provider: "nano-banana",
      promptFormat: 2,
      look: LOOK,
    }).production
    const still = p.shots[0]!.still!
    expect(still.direction).toEqual(IMAGE_WIRE)
    // A studio picker key here would look right in studio and fold NOTHING on
    // the canvas — assert the key SET, never a hardcoded list.
    for (const k of Object.keys(still.direction!)) {
      expect(DIRECTION_KEYS).toContain(k)
    }
  })

  it("stamps NOTHING for an unmarked (legacy) result", () => {
    const p = addStill({ shots: [{ id: "s1" }] }, "s1", {
      url: "https://r2.example/1.png",
      provider: "nano-banana",
      prompt: "a rooftop at dusk, wide shot, heavy fog",
      look: LOOK, // present but unmarked — the ids are already BAKED in the prose
    }).production
    expect(p.shots[0]!.still!.direction).toBeUndefined()
  })

  it("CLEARS an inherited direction when a legacy result lands (the D4 failure)", () => {
    let p = addStill({ shots: [{ id: "s1" }] }, "s1", {
      url: "https://r2.example/1.png",
      provider: "nano-banana",
      prompt: "a rooftop at dusk",
      promptFormat: 2,
      look: LOOK,
    }).production
    expect(p.shots[0]!.still!.direction).toEqual(IMAGE_WIRE)

    p = addStill(p, "s1", {
      url: "https://r2.example/2.png",
      provider: "nano-banana",
      prompt: "a rooftop at dusk, wide shot, heavy fog",
    }).production
    const still = p.shots[0]!.still!
    expect(still.direction).toBeUndefined()
    // …and the emitted node carries no `direction` KEY at all (not `{}`, not
    // `undefined`) — that key's presence IS the marker on the graph.
    const node = serializeProduction(p.shots, "s1").nodes.find(
      (n) => n.id === still.nodeId,
    )!
    expect("direction" in node.data).toBe(false)
  })

  it("stamps nothing for an EMPTY look, and never emits `direction: {}`", () => {
    const p = addStill({ shots: [{ id: "s1" }] }, "s1", {
      url: "https://r2.example/1.png",
      provider: "nano-banana",
      prompt: "a rooftop",
      promptFormat: 2,
      look: {},
    }).production
    const still = p.shots[0]!.still!
    expect(still.direction).toBeUndefined()
    expect("direction" in still).toBe(false)
  })

  it("stamps the LAYER SPLIT beside the merged ids (D-A1)", () => {
    const p = addStill({ shots: [{ id: "s1" }] }, "s1", {
      url: "https://r2.example/1.png",
      provider: "nano-banana",
      prompt: "a rooftop at dusk",
      promptFormat: 2,
      look: LOOK,
      filmLook: FILM,
      sceneLook: SCENE,
    }).production
    // The whole echo chain (composer submit → batch → job → here) exists to put
    // these on the RESULT; drop the stamp and every generated asset lands
    // merged-only, which reads as pre-D-A1 and splits by the FILM_LOOK_KEYS
    // heuristic instead of by the surface the ids were actually picked on.
    const result = p.shots[0]!.still!.results![0]!
    expect(result.filmLook).toEqual(FILM)
    expect(result.sceneLook).toEqual(SCENE)
    // INV-A3 at the landing site, not just at the submit.
    expect({ ...result.filmLook, ...result.sceneLook }).toEqual(result.look)
  })

  it("omits an EMPTY layer, and never stamps `filmLook: {}`", () => {
    const p = addStill({ shots: [{ id: "s1" }] }, "s1", {
      url: "https://r2.example/1.png",
      provider: "nano-banana",
      prompt: "a rooftop at dusk",
      promptFormat: 2,
      look: SCENE,
      filmLook: {}, // the film strip was genuinely untouched at submit
      sceneLook: SCENE,
    }).production
    const result = p.shots[0]!.still!.results![0]!
    // An empty map reads as "an armed selection of nothing" on restore — the
    // absent sibling already says the layer was empty (the discriminator).
    expect("filmLook" in result).toBe(false)
    expect(result.sceneLook).toEqual(SCENE)
  })

  it("copies on write — the handler never aliases the result's look projection", () => {
    const p = addStill({ shots: [{ id: "s1" }] }, "s1", {
      url: "https://r2.example/1.png",
      provider: "nano-banana",
      prompt: "a rooftop",
      promptFormat: 2,
      look: LOOK,
      subject: { age: "age-30s", ethnicity: ["eth-a", "eth-b"] },
    }).production
    const still = p.shots[0]!.still!
    const node = serializeProduction(p.shots, "s1").nodes.find(
      (n) => n.id === still.nodeId,
    )!
    // The emitted node is a COPY of the document, at every level.
    expect(node.data.direction).toEqual(still.direction)
    expect(node.data.direction).not.toBe(still.direction)
    expect(node.data.subject).not.toBe(still.subject)
    expect(
      (node.data.subject as { ethnicity?: unknown }).ethnicity,
    ).not.toBe(still.subject!.ethnicity)
  })

  it("keeps a LONE direction-bearing result's list (no collapse to `{ url }`)", () => {
    const p = addStill({ shots: [{ id: "s1" }] }, "s1", {
      url: "https://r2.example/1.png",
      provider: "nano-banana",
      prompt: "a rooftop",
      promptFormat: 2,
      look: LOOK,
    }).production
    // S3's keep-predicate: the marker + ids must survive the single-result
    // collapse, or D4 would suppress the pickers on a brand-new result.
    expect(p.shots[0]!.still!.results).toHaveLength(1)
    expect(p.shots[0]!.still!.results![0]!.promptFormat).toBe(2)
  })
})

// ── the schemas ─────────────────────────────────────────────────────────────

describe("the stills schemas", () => {
  it("parses the four ops and rejects a malformed one", () => {
    expect(
      stillsOpSchemas.add_still_result.parse({
        op: "add_still_result",
        shotId: "s1",
        result: { url: "https://r2/1.png", provider: "p", prompt: "q" },
        atFront: true,
      }).atFront,
    ).toBe(true)
    expect(
      stillsOpSchemas.set_active_still.safeParse({
        op: "set_active_still",
        shotId: "s1",
      }).success,
    ).toBe(false)
    // An INDEX is not an address here — `result` is a `ResultKey` string.
    expect(
      stillsOpSchemas.remove_still_result.safeParse({
        op: "remove_still_result",
        shotId: "s1",
        result: 0,
      }).success,
    ).toBe(false)
    expect(
      stillsOpSchemas.rename_still_result.safeParse({
        op: "rename_still_result",
        shotId: "s1",
        result: "u",
        name: "",
      }).success,
    ).toBe(true) // a blank name CLEARS it
  })
})

// Reset the id counter between files' worth of runs (vitest isolates modules,
// but the harness is explicit about it so a receipt id assertion cannot drift).
resetCtx()
