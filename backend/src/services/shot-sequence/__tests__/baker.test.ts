import { describe, it, expect } from "vitest"
import { bakeShotSequence, EmptyAlignmentError, SceneOverlapError } from "../baker.js"
import type { AlignmentWord } from "../../../providers/elevenlabs/forced-alignment.js"
import type { ShotSequenceBrief } from "../brief-schema.js"

const ALIGN: AlignmentWord[] = [
  { word: "ship", start: 0, end: 1 },
  { word: "faster", start: 1, end: 2 },
  { word: "today", start: 2, end: 3 },
]

function brief(overrides: Partial<ShotSequenceBrief> = {}): ShotSequenceBrief {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    backgroundColor: "#000",
    narration: { script: "ship faster today", cues: [{ id: "c1", text: "ship" }, { id: "c2", text: "today" }] },
    scenes: [
      {
        id: "s1",
        shots: [
          {
            id: "sh1",
            reveals: [
              { id: "r1", element: { id: "t1", type: "text", text: "Ship", fontFamily: "Inter", fontSize: 80, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "cue", cueId: "c1", edge: "start" }, enter: { motion: "fade", durationFrames: 6 } },
              { id: "r2", element: { id: "t2", type: "text", text: "Today", fontFamily: "Inter", fontSize: 80, color: "#fff", x: 0, y: 100 }, revealAt: { kind: "cue", cueId: "c2", edge: "start" }, enter: { motion: "fade", durationFrames: 6 } },
            ],
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe("bakeShotSequence", () => {
  it("bakes cue starts to round(sec*fps) scene-relative frames", () => {
    const { plan, warnings } = bakeShotSequence(brief(), ALIGN, "https://r2/vo.mp3")
    expect(warnings).toEqual([])
    expect(plan.planType).toBe("shot-sequence")
    // c1 start=0s → frame 0; c2 start=2s → 60. Scene starts at min reveal frame (0).
    expect(plan.scenes[0].startFrame).toBe(0)
    expect(plan.scenes[0].shots[0].reveals[0].frame).toBe(0)
    expect(plan.scenes[0].shots[0].reveals[1].frame).toBe(60)
    expect(plan.audio.src).toBe("https://r2/vo.mp3")
  })

  it("uses edge:end (end of the word's audio)", () => {
    const b = brief()
    b.scenes[0].shots[0].reveals[0].revealAt = { kind: "cue", cueId: "c1", edge: "end" }
    const { plan } = bakeShotSequence(b, ALIGN, "https://r2/vo.mp3")
    // c1 end = 1s → ABSOLUTE frame 30. The scene's other reveal (c2 start, frame 60)
    // pulls startAbs to min(30,60)=30, so r1 rebases to scene-relative 0; assert absolute.
    expect(plan.scenes[0].startFrame + plan.scenes[0].shots[0].reveals[0].frame).toBe(30)
  })

  it("clamps a negative offset to frame 0", () => {
    const b = brief()
    b.scenes[0].shots[0].reveals[0].revealAt = { kind: "cue", cueId: "c1", edge: "start", offsetMs: -5000 }
    const { plan } = bakeShotSequence(b, ALIGN, "https://r2/vo.mp3")
    expect(plan.scenes[0].shots[0].reveals[0].frame).toBe(0)
  })

  it("honors a frame anchor and rebases it scene-relative", () => {
    const b = brief()
    b.scenes[0].shots[0].reveals[0].revealAt = { kind: "frame", frame: 45 }
    b.scenes[0].shots[0].reveals[1].revealAt = { kind: "frame", frame: 90 }
    const { plan } = bakeShotSequence(b, ALIGN, "https://r2/vo.mp3")
    expect(plan.scenes[0].startFrame).toBe(45)
    expect(plan.scenes[0].shots[0].reveals[0].frame).toBe(0) // 45 - 45
    expect(plan.scenes[0].shots[0].reveals[1].frame).toBe(45) // 90 - 45
  })

  it("strips revealAt from the resolved reveals", () => {
    const { plan } = bakeShotSequence(brief(), ALIGN, "https://r2/vo.mp3")
    expect((plan.scenes[0].shots[0].reveals[0] as Record<string, unknown>).revealAt).toBeUndefined()
  })

  it("computes duration from the narration tail + extends the last scene", () => {
    const { plan } = bakeShotSequence(brief(), ALIGN, "https://r2/vo.mp3")
    // narration ends at 3s → 90 frames + TAIL(fps=30) = 120
    expect(plan.durationInFrames).toBe(120)
    expect(plan.scenes[0].startFrame + plan.scenes[0].durationInFrames).toBe(120)
  })

  it("prefers opts.audioDurationMs for duration", () => {
    const { plan } = bakeShotSequence(brief(), ALIGN, "https://r2/vo.mp3", { audioDurationMs: 5000 })
    // 5000ms → 150 + 30 tail = 180
    expect(plan.durationInFrames).toBe(180)
  })

  it("sorts scenes by start frame", () => {
    const b = brief()
    // Two scenes: scene B anchored earlier than scene A by frame
    b.scenes = [
      { id: "late", shots: [{ id: "shL", reveals: [{ id: "rL", element: { id: "tl", type: "text", text: "L", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 100 }, enter: { motion: "fade", durationFrames: 6 } }] }] },
      { id: "early", shots: [{ id: "shE", reveals: [{ id: "rE", element: { id: "te", type: "text", text: "E", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 0 }, enter: { motion: "fade", durationFrames: 6 } }] }] },
    ]
    const { plan } = bakeShotSequence(b, ALIGN, "https://r2/vo.mp3")
    expect(plan.scenes.map((s) => s.id)).toEqual(["early", "late"])
  })

  it("throws SceneOverlapError when scene windows interleave", () => {
    const b = brief()
    b.scenes = [
      { id: "a", shots: [{ id: "sha", reveals: [
        { id: "ra1", element: { id: "ta1", type: "text", text: "A1", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 0 }, enter: { motion: "fade", durationFrames: 6 } },
        { id: "ra2", element: { id: "ta2", type: "text", text: "A2", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 100 }, enter: { motion: "fade", durationFrames: 6 } },
      ] }] },
      { id: "b", shots: [{ id: "shb", reveals: [
        { id: "rb1", element: { id: "tb1", type: "text", text: "B1", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 50 }, enter: { motion: "fade", durationFrames: 6 } },
      ] }] },
    ]
    // scene a spans [0,106), scene b spans [50,56) → interleave
    expect(() => bakeShotSequence(b, ALIGN, "https://r2/vo.mp3")).toThrow(SceneOverlapError)
  })

  it("throws EmptyAlignmentError when cue-anchored but no cue matched", () => {
    expect(() => bakeShotSequence(brief(), [], "https://r2/vo.mp3")).toThrow(EmptyAlignmentError)
  })

  it("resolves a frame-only brief even with empty alignment", () => {
    const b = brief()
    b.scenes[0].shots[0].reveals = [
      { id: "r1", element: { id: "t1", type: "text", text: "Intro", fontFamily: "Inter", fontSize: 80, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 0 }, enter: { motion: "none", durationFrames: 0 } },
    ]
    b.narration.cues = [{ id: "c1", text: "ship" }] // cue exists but unused by reveals
    expect(() => bakeShotSequence(b, [], "https://r2/vo.mp3")).not.toThrow()
  })

  it("resolves a multi-scene cue-anchored brief into sorted, non-overlapping windows", () => {
    const align: AlignmentWord[] = [
      { word: "ship", start: 0, end: 1 },
      { word: "faster", start: 1, end: 2 },
      { word: "every", start: 5, end: 6 },
      { word: "day", start: 6, end: 7 },
    ]
    const b = brief()
    b.narration = { script: "ship faster every day", cues: [{ id: "c1", text: "ship" }, { id: "c2", text: "day" }] }
    b.scenes = [
      { id: "sceneA", shots: [{ id: "shA", reveals: [
        { id: "rA", element: { id: "ta", type: "text", text: "A", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "cue", cueId: "c1", edge: "start" }, enter: { motion: "fade", durationFrames: 6 } },
      ] }] },
      { id: "sceneB", shots: [{ id: "shB", reveals: [
        { id: "rB", element: { id: "tb", type: "text", text: "B", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "cue", cueId: "c2", edge: "start" }, enter: { motion: "fade", durationFrames: 6 } },
      ] }] },
    ]
    const { plan } = bakeShotSequence(b, align, "https://r2/vo.mp3")
    expect(plan.scenes.map((s) => s.id)).toEqual(["sceneA", "sceneB"]) // sorted by start
    expect(plan.scenes[0].startFrame).toBe(0)   // c1 "ship" start 0s
    expect(plan.scenes[1].startFrame).toBe(180) // c2 "day" start 6s → 180
    // absolute reveal frames land on the cues
    expect(plan.scenes[0].startFrame + plan.scenes[0].shots[0].reveals[0].frame).toBe(0)
    expect(plan.scenes[1].startFrame + plan.scenes[1].shots[0].reveals[0].frame).toBe(180)
  })

  it("mixes cue + frame anchors in one scene (lowest anchor wins the window)", () => {
    const b = brief()
    // r1 frame-anchored at 20; r2 stays cue c2 start (2s → frame 60).
    b.scenes[0].shots[0].reveals[0].revealAt = { kind: "frame", frame: 20 }
    const { plan } = bakeShotSequence(b, ALIGN, "https://r2/vo.mp3")
    expect(plan.scenes[0].startFrame).toBe(20) // min(frame 20, cue 60)
    expect(plan.scenes[0].shots[0].reveals[0].frame).toBe(0)  // 20 - 20
    expect(plan.scenes[0].shots[0].reveals[1].frame).toBe(40) // 60 - 20
    // both rebase back to their absolute positions
    expect(plan.scenes[0].startFrame + plan.scenes[0].shots[0].reveals[0].frame).toBe(20)
    expect(plan.scenes[0].startFrame + plan.scenes[0].shots[0].reveals[1].frame).toBe(60)
  })

  it("accounts for hold + exit in the scene end / composition duration", () => {
    const b = brief()
    b.narration.cues = [{ id: "c1", text: "ship" }] // present but unused by reveals
    b.scenes[0].shots[0].reveals = [
      { id: "r1", element: { id: "t1", type: "text", text: "X", fontFamily: "Inter", fontSize: 80, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 100 }, enter: { motion: "fade", durationFrames: 6 }, hold: 20, exit: { motion: "fade", durationFrames: 10 } },
    ]
    // No alignment → narration tail is 0; the scene's own end drives duration.
    const { plan } = bakeShotSequence(b, [], "https://r2/vo.mp3")
    // endAbs = frame 100 + enter 6 + hold 20 + exit 10 = 136
    expect(plan.durationInFrames).toBe(136)
    expect(plan.scenes[0].startFrame).toBe(100)
    expect(plan.scenes[0].durationInFrames).toBe(36) // 136 - 100 = enter + hold + exit
  })

  it("shifts a cue reveal forward by a positive offsetMs", () => {
    const b = brief()
    // c1 start 0s + 500ms @ fps 30 → +15 frames (vs un-offset frame 0).
    b.scenes[0].shots[0].reveals[0].revealAt = { kind: "cue", cueId: "c1", edge: "start", offsetMs: 500 }
    const { plan } = bakeShotSequence(b, ALIGN, "https://r2/vo.mp3")
    // startAbs = min(15, 60) = 15; r1 rebases to 0, absolute = 15
    expect(plan.scenes[0].startFrame + plan.scenes[0].shots[0].reveals[0].frame).toBe(15)
  })
})
