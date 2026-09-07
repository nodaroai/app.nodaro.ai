/**
 * The `clips` section — `add_clip_result` and INV-D on the clip.
 *
 * One of three siblings carrying the ported clip suite; the harness, and the
 * doc comment that explains the port, live in
 * `./helpers/clips-fixtures.ts`. The assertions here are untouched.
 */

import { describe, expect, it } from "vitest"
import {
  ATMOSPHERES,
  CAMERA_MOTIONS,
  FRAMINGS,
  getAtmospherePromptHint,
  getCameraMotionPromptHint,
  getFramingPromptHint,
} from "@nodaro/prompts"

import { directionWireFields } from "../../direction"
import { CAMERA_MOVEMENT_KEY } from "../../look-pickers"
import { clipResults } from "../../shot"
import type { LookSelectionMap } from "../../shot"
import type { Production } from "../production"
import { clipsHandlers } from "../sections/clips"

import {
  add,
  ctx,
  expectRefused,
  framedShot,
  prod,
  rename,
  setActive,
  shotWith,
  stillOnly,
} from "./helpers/clips-fixtures"

describe("add_clip_result (addShotClipResult)", () => {
  it("creates the clip on the first result, keeping the frames it was made from", () => {
    let p = prod([framedShot("a")])
    p = add(p, "a", { url: "https://r2/clip1.mp4" })
    const clip = p.shots[0].clip
    expect(clip?.url).toBe("https://r2/clip1.mp4")
    expect(clip?.nodeId).toBe("generate-video-a")
    // The take records the frames it was animated FROM, and the clip level
    // mirrors neither — so the lone result KEEPS its list (buildClip's
    // keep-predicate) instead of collapsing them away on the next reload.
    expect(clip?.results).toEqual([
      {
        url: "https://r2/clip1.mp4",
        startFrameUrl: "https://r2/a-start.png",
        endFrameUrl: "https://r2/a-end.png",
      },
    ])
  })

  it("a take RENAME does not drop the marker either", () => {
    let p = prod([framedShot("a")])
    const look = { colorLookId: "warm" }
    p = add(p, "a", { url: "https://r2/clip1.mp4", promptFormat: 2, look })
    p = rename(p, "a", "https://r2/clip1.mp4", "Crash")
    const [take] = clipResults(p.shots[0].clip!)
    expect(take.name).toBe("Crash")
    expect(take.promptFormat).toBe(2)
    expect(take.look).toEqual(look)
  })

  it("carries the prompt-format marker + look ids onto the take", () => {
    let p = prod([framedShot("a")])
    const look = { colorLookId: "warm", cameraMotionId: "dolly-in" }
    p = add(p, "a", { url: "https://r2/clip1.mp4", promptFormat: 2, look })
    const [take] = clipResults(p.shots[0].clip!)
    expect(take.promptFormat).toBe(2)
    expect(take.look).toEqual(look)
  })

  it("carries the take's name, SHOTS and levers (the four this builder dropped)", () => {
    let p = prod([framedShot("a")])
    const beats = [{ id: "b1", seconds: 2, text: "she turns" }]
    p = add(p, "a", {
      url: "https://r2/clip1.mp4",
      name: "Crash",
      beats,
      aspectRatio: "16:9",
      resolution: "1080p",
    })
    const [take] = clipResults(p.shots[0].clip!)
    expect(take.name).toBe("Crash")
    expect(take.beats).toEqual(beats)
    expect(take.aspectRatio).toBe("16:9")
    expect(take.resolution).toBe("1080p")
    // Copied, not aliased — the handler is copy-on-write.
    expect(take.beats).not.toBe(beats)
  })

  it("carries the SCENE PROMPT the take was made under", () => {
    let p = prod([framedShot("a")])
    p = add(p, "a", {
      url: "https://r2/clip1.mp4",
      scenePrompt: "A rain-soaked rooftop chase.",
    })
    const [take] = clipResults(p.shots[0].clip!)
    expect(take.scenePrompt).toBe("A rain-soaked rooftop chase.")
  })

  it("accumulates videos per shot — results grow, newest is active, node id stable", () => {
    let p = prod([framedShot("a")])
    p = add(p, "a", { url: "https://r2/1.mp4" })
    const node1 = p.shots[0].clip?.nodeId
    p = add(p, "a", { url: "https://r2/2.mp4" })
    p = add(p, "a", { url: "https://r2/3.mp4" })
    const clip = p.shots[0].clip
    expect(clip?.results?.map((r) => r.url)).toEqual([
      "https://r2/1.mp4",
      "https://r2/2.mp4",
      "https://r2/3.mp4",
    ])
    expect(clip?.activeIndex).toBe(2)
    expect(clip?.url).toBe("https://r2/3.mp4") // newest is active
    expect(clip?.nodeId).toBe(node1) // one node, results accumulate under it
  })

  it("keeps the result's `/` voice directions + video/audio reference urls (no field drop)", () => {
    let p = prod([framedShot("a")])
    p = add(p, "a", { url: "https://r2/0.mp4" }) // ≥2 stops the collapse
    p = add(p, "a", {
      url: "https://r2/1.mp4",
      prompt: "she waves [applause]",
      directions: [{ kind: "sfx", text: "applause" }],
      referenceVideoUrls: ["https://r2/motion.mp4"],
      referenceAudioUrls: ["https://r2/voice.mp3"],
    })
    const active = p.shots[0].clip?.results?.at(-1)
    expect(active?.directions).toEqual([{ kind: "sfx", text: "applause" }])
    expect(active?.referenceVideoUrls).toEqual(["https://r2/motion.mp4"])
    expect(active?.referenceAudioUrls).toEqual(["https://r2/voice.mp3"])
  })

  it("captures the shot's CURRENT start/end frames onto the result (#9c)", () => {
    let p = prod([framedShot("a")])
    p = add(p, "a", { url: "https://r2/1.mp4" })
    p = add(p, "a", { url: "https://r2/2.mp4" })
    const results = p.shots[0].clip?.results
    expect(results?.[1].startFrameUrl).toBe("https://r2/a-start.png")
    expect(results?.[1].endFrameUrl).toBe("https://r2/a-end.png")
  })

  it("prefers caller-supplied source frames over the shot's current frames", () => {
    let p = prod([framedShot("a")])
    p = add(p, "a", { url: "https://r2/1.mp4" })
    p = add(p, "a", {
      url: "https://r2/2.mp4",
      startFrameUrl: "https://r2/explicit-start.png",
      endFrameUrl: "https://r2/explicit-end.png",
    })
    const results = p.shots[0].clip?.results
    // The explicit frames win over the shot's "a-start/a-end" current frames.
    expect(results?.[1].startFrameUrl).toBe("https://r2/explicit-start.png")
    expect(results?.[1].endFrameUrl).toBe("https://r2/explicit-end.png")
  })

  it("omits source-frame keys when the shot has no frames (minimal result)", () => {
    let p = prod([stillOnly("a")]) // no start/end frame
    p = add(p, "a", { url: "https://r2/1.mp4" })
    p = add(p, "a", { url: "https://r2/2.mp4" })
    const results = p.shots[0].clip?.results
    expect(results?.[0]).not.toHaveProperty("startFrameUrl")
    expect(results?.[0]).not.toHaveProperty("endFrameUrl")
  })

  it("records references AND the end frame on a references-mode result", () => {
    let p = prod([framedShot("a")]) // shot has a-start + a-end
    p = add(p, "a", { url: "https://r2/1.mp4" })
    p = add(p, "a", {
      url: "https://r2/2.mp4",
      referenceImageUrls: ["https://r2/ref1.png", "https://r2/ref2.png"],
    })
    const r = p.shots[0].clip?.results?.[1]
    expect(r?.referenceImageUrls).toEqual([
      "https://r2/ref1.png",
      "https://r2/ref2.png",
    ])
    expect(r?.startFrameUrl).toBe("https://r2/a-start.png") // start frame kept
    expect(r?.endFrameUrl).toBe("https://r2/a-end.png") // …and the end frame
  })

  it("carries the result prompt + jobId onto the active result; the re-expanded first keeps its prompt", () => {
    let p = prod([stillOnly("a")])
    p = add(p, "a", { url: "https://r2/1.mp4", prompt: "first", jobId: "j1" })
    p = add(p, "a", { url: "https://r2/2.mp4", prompt: "drift left", jobId: "j2" })
    const results = p.shots[0].clip?.results
    expect(results?.[1].prompt).toBe("drift left")
    expect(results?.[1].jobId).toBe("j2")
    expect(results?.[0].prompt).toBe("first") // clip-level mirror, carried back
    expect(results?.[0]).not.toHaveProperty("jobId")
  })

  it("preserves re-voice provenance from the existing clip across a new result", () => {
    let p = prod([stillOnly("a")])
    p = add(p, "a", {
      url: "https://r2/0.mp4",
      provider: "grok-i2v",
      prompt: "move",
      duration: 5,
      revoicedVoiceId: "voice-123",
      revoicedVoiceName: "Rachel",
    })
    p = add(p, "a", { url: "https://r2/1.mp4" })
    const clip = p.shots[0].clip
    expect(clip?.url).toBe("https://r2/1.mp4")
    expect(clip?.revoicedVoiceId).toBe("voice-123")
    expect(clip?.revoicedVoiceName).toBe("Rachel")
    expect(clip?.duration).toBe(5)
  })

  it("seeds clip-level provider/duration from the FIRST result (card label + serialize)", () => {
    let p = prod([stillOnly("a")])
    p = add(p, "a", {
      url: "https://r2/1.mp4",
      provider: "grok-i2v",
      duration: 8,
    })
    const clip = p.shots[0].clip
    expect(clip?.provider).toBe("grok-i2v")
    expect(clip?.duration).toBe(8)
  })

  it("keeps clip-level provider/duration stable across later results", () => {
    let p = prod([stillOnly("a")])
    p = add(p, "a", { url: "https://r2/1.mp4", provider: "grok-i2v", duration: 8 })
    p = add(p, "a", { url: "https://r2/2.mp4" })
    const clip = p.shots[0].clip
    expect(clip?.provider).toBe("grok-i2v")
    expect(clip?.duration).toBe(8)
  })

  it("stores PER-RESULT provider/duration on each clip result (directing clip-select restore)", () => {
    let p = prod([stillOnly("a")])
    p = add(p, "a", { url: "https://r2/1.mp4", provider: "grok-i2v", duration: 5 })
    p = add(p, "a", { url: "https://r2/2.mp4", provider: "veo-3", duration: 8 })
    const results = p.shots[0].clip?.results
    expect(results?.[1].provider).toBe("veo-3")
    expect(results?.[1].duration).toBe(8)
    expect(results?.[0].provider).toBe("grok-i2v")
    expect(results?.[0].duration).toBe(5)
    // prompt/jobId stay collapsed away (they have per-result restore paths of
    // their own and no clip-level mirror to preserve).
    expect(results?.[0]).not.toHaveProperty("prompt")
    expect(results?.[0]).not.toHaveProperty("jobId")
  })

  it("the clip level FOLLOWS the active take — append, step back, step forward", () => {
    let p = prod([stillOnly("a")])
    p = add(p, "a", { url: "https://r2/orig.mp4", provider: "seedance-2", duration: 5 })
    // The editor's append (apply-edited-clip): edited marker + measured length.
    p = add(p, "a", { url: "https://r2/edit.mp4", provider: "freecut-edit", duration: 1.9 })

    let clip = p.shots[0].clip
    expect(clip?.duration).toBe(1.9)
    // The edited marker is result-level provenance — the clip keeps the REAL
    // model so the canvas node stays runnable.
    expect(clip?.provider).toBe("seedance-2")

    // Stepping back to the original brings its length back to the card…
    p = setActive(p, "a", "https://r2/orig.mp4")
    clip = p.shots[0].clip
    expect(clip?.duration).toBe(5)
    expect(clip?.provider).toBe("seedance-2")

    // …and forward to the edit again.
    p = setActive(p, "a", "https://r2/edit.mp4")
    expect(p.shots[0].clip?.duration).toBe(1.9)
  })

  it("sets re-voice provenance from a re-voiced append (caller value wins)", () => {
    let p = prod([stillOnly("a")])
    p = add(p, "a", {
      url: "https://r2/revoiced.mp4",
      provider: "veo-3",
      duration: 5,
      revoicedVoiceId: "voice-xyz",
      revoicedVoiceName: "River",
    })
    const clip = p.shots[0].clip
    expect(clip?.revoicedVoiceId).toBe("voice-xyz")
    expect(clip?.revoicedVoiceName).toBe("River")
  })

  it("grows a clip on a still-less shot (references mode — no framing still)", () => {
    const id = "a"
    let p = prod([shotWith(id)]) // empty shot, no still
    p = add(p, id, {
      url: "https://r2/1.mp4",
      provider: "seedance-2",
      duration: 6,
      referenceImageUrls: ["https://r2/ref1.png"],
    })
    const shot = p.shots[0]
    expect(shot.still).toBeUndefined() // still NOT invented
    expect(shot.clip?.url).toBe("https://r2/1.mp4")
    expect(shot.clip?.nodeId).toBe(`generate-video-${id}`)
  })

  it("returns a NEW array; REFUSES an unknown shot id", () => {
    // CONVERTED: the reducer no-ops on an unknown shot; the operation refuses it
    // (`SECTIONS.md` rule 5). The copy-on-write half is the studio assertion.
    const before = prod([stillOnly("a")])
    const after = add(before, "a", { url: "https://r2/1.mp4" })
    expect(Object.is(before.shots, after.shots)).toBe(false)
    expect(before.shots[0].clip).toBeUndefined() // copy-on-write

    expectRefused(
      () =>
        clipsHandlers.add_clip_result(
          after,
          { op: "add_clip_result", shotId: "nope", result: { url: "https://r2/x.mp4" } },
          ctx,
        ),
      "op_target_missing",
    )
  })

  it("atFront inserts as take #1 + active (the continuity opening), even after others exist", () => {
    // NO STUDIO ORACLE: `addShotClipResult` takes no `atFront`; §6 gives the
    // clip op one, so this mirrors the STILL side's atFront test
    // (`production-store.test.ts` L413) exactly — insert at index 0, and index 0
    // becomes the active take.
    let p = prod([stillOnly("a")])
    p = add(p, "a", { url: "https://r2/cand1.mp4" })
    p = add(p, "a", { url: "https://r2/cand2.mp4" })
    p = add(p, "a", { url: "https://r2/opening.mp4" }, true)
    const clip = p.shots[0].clip
    expect(clip?.results?.map((r) => r.url)).toEqual([
      "https://r2/opening.mp4", // take #1 — the opening
      "https://r2/cand1.mp4",
      "https://r2/cand2.mp4",
    ])
    expect(clip?.activeIndex).toBe(0) // and it's the active/shown take
    expect(clip?.url).toBe("https://r2/opening.mp4")
  })
})

// ── INV-D (ported from `production-store.direction.test.ts`) ────────────────

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
const FILM: LookSelectionMap = { atmosphereId: atmosphere.id }
const SCENE: LookSelectionMap = { framingId: framing.id }
const CLIP_SCENE: LookSelectionMap = {
  ...SCENE,
  [CAMERA_MOVEMENT_KEY]: motion.id,
}
const VIDEO_WIRE = directionWireFields(CLIP_LOOK, "video")!

describe("add_clip_result — INV-D on the clip (the asymmetric base)", () => {
  const seedMarkedClip = (): Production =>
    add(prod([shotWith("s1")]), "s1", {
      url: "https://r2.example/1.mp4",
      prompt: "a slow dolly in",
      provider: "grok-i2v",
      promptFormat: 2,
      look: CLIP_LOOK,
    })

  it("rebases both prompt and direction for a marked result", () => {
    const p = seedMarkedClip()
    const clip = p.shots[0]!.clip!
    expect(clip.prompt).toBe("a slow dolly in")
    expect(clip.direction).toEqual(VIDEO_WIRE)
    expect(clip.direction).toHaveProperty("cameraMotion")
  })

  it("PRESERVES both for a promptless append (the re-voice chain shape)", () => {
    let p = seedMarkedClip()
    p = add(p, "s1", { url: "https://r2.example/2.mp4" })
    const clip = p.shots[0]!.clip!
    // The direction travels WITH the prompt — neither rebases here, so neither
    // may be dropped.
    expect(clip.prompt).toBe("a slow dolly in")
    expect(clip.direction).toEqual(VIDEO_WIRE)
  })

  it("stamps the take's LAYER SPLIT too (D-A1), camera motion on the scene half", () => {
    const p = add(prod([shotWith("s1")]), "s1", {
      url: "https://r2.example/1.mp4",
      prompt: "a slow dolly in",
      provider: "grok-i2v",
      promptFormat: 2,
      look: CLIP_LOOK,
      filmLook: FILM,
      sceneLook: CLIP_SCENE,
    })
    const result = p.shots[0]!.clip!.results![0]!
    expect(result.filmLook).toEqual(FILM)
    expect(result.sceneLook).toEqual(CLIP_SCENE)
    // INV-A3 holds on the clip too, carve-outs and all — the camera motion is a
    // per-clip pick, so it rides the SCENE half rather than the film's.
    expect({ ...result.filmLook, ...result.sceneLook }).toEqual(result.look)
  })

  it("clears direction while rebasing prompt for an unmarked result", () => {
    let p = seedMarkedClip()
    p = add(p, "s1", {
      url: "https://r2.example/3.mp4",
      prompt: "a slow dolly in, wide shot, heavy fog",
    })
    const clip = p.shots[0]!.clip!
    expect(clip.prompt).toBe("a slow dolly in, wide shot, heavy fog")
    expect(clip.direction).toBeUndefined()
  })
})
