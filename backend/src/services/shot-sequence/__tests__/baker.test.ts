import { describe, it, expect } from "vitest"
import { bakeShotSequence, EmptyAlignmentError, SceneOverlapError } from "../baker.js"
import type { AlignmentWord } from "../../../providers/elevenlabs/forced-alignment.js"
import type { BriefReveal } from "../brief-schema.js"
import { ALIGN, brief } from "./baker-fixtures.js"

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

  it("clamps a blueprint tail that overflows into the next scene instead of throwing (regression)", () => {
    // A blueprint's durationFrames (here 120) can run a scene's tail past the next
    // scene's start. Because the blueprint is ANCHORED before the next scene (frame 0
    // < 100), this is a recoverable tail overflow, NOT interleave — the abut/render
    // logic already trims the scene to the next scene's start, so the baker must NOT
    // throw SceneOverlapError (this failed a real prod explainer render).
    const b = brief()
    b.narration = { script: "a b", cues: [{ id: "c1", text: "a" }] }
    b.scenes = [
      { id: "scene-a", shots: [{ id: "sha", reveals: [
        { id: "ra", blueprint: { id: "dataviz-countup", params: { value: 8, label: "hrs wasted" } }, revealAt: { kind: "frame", frame: 0 }, durationFrames: 120 },
      ] }] },
      { id: "scene-b", shots: [{ id: "shb", reveals: [
        { id: "rb", element: { id: "tb", type: "text", text: "B", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 100 }, enter: { motion: "fade", durationFrames: 6 } },
      ] }] },
    ]
    const { plan } = bakeShotSequence(b, [], "https://r2/vo.mp3")
    expect(plan.scenes.map((s) => s.id)).toEqual(["scene-a", "scene-b"])
    // scene-a abuts scene-b (its window clamps to scene-b's start); the blueprint trims to fit.
    expect(plan.scenes[1].startFrame).toBe(100)
    expect(plan.scenes[0].startFrame + plan.scenes[0].durationInFrames).toBe(plan.scenes[1].startFrame)
  })

  it("still throws SceneOverlapError when a reveal is ANCHORED past the next scene's start (genuine interleave)", () => {
    const b = brief()
    b.narration = { script: "a b", cues: [{ id: "c1", text: "a" }] }
    b.scenes = [
      { id: "scene-a", shots: [{ id: "sha", reveals: [
        { id: "ra1", element: { id: "ta1", type: "text", text: "A1", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 0 }, enter: { motion: "fade", durationFrames: 6 } },
        // anchored at 200 — AFTER scene-b's start (100): genuinely interleaved, a real mis-order.
        { id: "ra2", element: { id: "ta2", type: "text", text: "A2", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 200 }, enter: { motion: "fade", durationFrames: 6 } },
      ] }] },
      { id: "scene-b", shots: [{ id: "shb", reveals: [
        { id: "rb", element: { id: "tb", type: "text", text: "B", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 100 }, enter: { motion: "fade", durationFrames: 6 } },
      ] }] },
    ]
    expect(() => bakeShotSequence(b, [], "https://r2/vo.mp3")).toThrow(SceneOverlapError)
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

  it("extends a non-last scene to abut the next scene's start (no inter-scene blank gap)", () => {
    const b = brief()
    // Frame-anchored reveals (empty alignment is fine): scene A's content ends at
    // frame 16 (enter 6 + hold 10), but scene B doesn't start until frame 100. The
    // baker must keep scene A mounted until B mounts so held content fills the gap,
    // instead of unmounting at 16 and leaving frames [16,100) blank.
    b.narration = { script: "ship today", cues: [{ id: "c1", text: "ship" }] }
    b.scenes = [
      { id: "sceneA", shots: [{ id: "shA", reveals: [
        { id: "rA", element: { id: "ta", type: "text", text: "A", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 0 }, enter: { motion: "fade", durationFrames: 6 }, hold: 10 },
      ] }] },
      { id: "sceneB", shots: [{ id: "shB", reveals: [
        { id: "rB", element: { id: "tb", type: "text", text: "B", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 100 }, enter: { motion: "fade", durationFrames: 6 } },
      ] }] },
    ]
    const { plan } = bakeShotSequence(b, [], "https://r2/vo.mp3")
    expect(plan.scenes.map((s) => s.id)).toEqual(["sceneA", "sceneB"])
    expect(plan.scenes[0].startFrame).toBe(0)
    expect(plan.scenes[1].startFrame).toBe(100)
    // Scene A abuts Scene B exactly: end of A === start of B (was 16 before the fix).
    expect(plan.scenes[0].startFrame + plan.scenes[0].durationInFrames).toBe(plan.scenes[1].startFrame)
    // Last scene still extends to fill the composition (unchanged).
    expect(plan.scenes[1].startFrame + plan.scenes[1].durationInFrames).toBe(plan.durationInFrames)
  })

  it("emits scene cross-dissolve frames (in on non-first, out on non-last) without overlapping windows", () => {
    const b = brief()
    b.narration = { script: "a b c", cues: [{ id: "c1", text: "a" }] }
    const mk = (id: string, tid: string, text: string, frame: number): BriefReveal => ({
      id, element: { id: tid, type: "text", text, fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 },
      revealAt: { kind: "frame", frame }, enter: { motion: "fade", durationFrames: 6 },
    })
    b.scenes = [
      { id: "A", shots: [{ id: "shA", reveals: [mk("rA", "ta", "A", 0)] }] },
      { id: "B", shots: [{ id: "shB", reveals: [mk("rB", "tb", "B", 100)] }] },
      { id: "C", shots: [{ id: "shC", reveals: [mk("rC", "tc", "C", 200)] }] },
    ]
    const { plan } = bakeShotSequence(b, [], "https://r2/vo.mp3")
    const [A, B, C] = plan.scenes
    // fps 30 → out 4 / in 3 (the Seamless-Join recipe, video half).
    expect(A.transitionInFrames).toBeUndefined() // first scene opens normally
    expect(A.transitionOutFrames).toBe(4)
    expect(B.transitionInFrames).toBe(3) // middle scene cross-dissolves both ways
    expect(B.transitionOutFrames).toBe(4)
    expect(C.transitionInFrames).toBe(3)
    expect(C.transitionOutFrames).toBeUndefined() // last scene holds to the end
    // Stored windows stay non-overlapping/abutting (durationInFrames excludes the overlap):
    expect(A.startFrame + A.durationInFrames).toBe(B.startFrame)
    expect(B.startFrame + B.durationInFrames).toBe(C.startFrame)
  })

  it("cut-the-curve: exitTransition on scene N sets N's cut-the-curve exit AND N+1's cut-the-curve entry (mirrored)", () => {
    const b = brief()
    b.narration = { script: "a b c", cues: [{ id: "c1", text: "a" }] }
    const mk = (id: string, tid: string, text: string, frame: number): BriefReveal => ({
      id, element: { id: tid, type: "text", text, fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 },
      revealAt: { kind: "frame", frame }, enter: { motion: "fade", durationFrames: 6 },
    })
    b.scenes = [
      { id: "A", shots: [{ id: "shA", reveals: [mk("rA", "ta", "A", 0)] }], exitTransition: { type: "cut-the-curve", direction: "left" } },
      { id: "B", shots: [{ id: "shB", reveals: [mk("rB", "tb", "B", 100)] }] }, // no exitTransition of its own
      { id: "C", shots: [{ id: "shC", reveals: [mk("rC", "tc", "C", 200)] }] },
    ]
    const { plan } = bakeShotSequence(b, [], "https://r2/vo.mp3")
    const [A, B, C] = plan.scenes
    // fps 30 → cut-the-curve out round(0.3*30)=9, in round(0.34*30)=10.
    expect(A.transitionOutFrames).toBe(9)
    expect(A.transitionOutType).toBe("cut-the-curve")
    expect(A.transitionOutDirection).toBe("left")
    expect(A.transitionInFrames).toBeUndefined() // first scene, no entry treatment
    // B's ENTRY mirrors A's exitTransition (type+direction), even though B authored none itself.
    expect(B.transitionInFrames).toBe(10)
    expect(B.transitionInType).toBe("cut-the-curve")
    expect(B.transitionInDirection).toBe("left")
    // B has no exitTransition of its own → B's EXIT stays plain crossfade (independent of its entry).
    expect(B.transitionOutFrames).toBe(4)
    expect(B.transitionOutType).toBeUndefined()
    expect(B.transitionOutDirection).toBeUndefined()
    // C's entry mirrors B's (absent) exitTransition → plain crossfade, unaffected by A's cut.
    expect(C.transitionInFrames).toBe(3)
    expect(C.transitionInType).toBeUndefined()
    // Stored windows still stay non-overlapping/abutting regardless of transition type.
    expect(A.startFrame + A.durationInFrames).toBe(B.startFrame)
    expect(B.startFrame + B.durationInFrames).toBe(C.startFrame)
  })

  it("cut-the-curve: a scene's own exit direction can differ from its inherited entry direction", () => {
    const b = brief()
    b.narration = { script: "a b c", cues: [{ id: "c1", text: "a" }] }
    const mk = (id: string, tid: string, text: string, frame: number): BriefReveal => ({
      id, element: { id: tid, type: "text", text, fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 },
      revealAt: { kind: "frame", frame }, enter: { motion: "fade", durationFrames: 6 },
    })
    b.scenes = [
      { id: "A", shots: [{ id: "shA", reveals: [mk("rA", "ta", "A", 0)] }], exitTransition: { type: "cut-the-curve", direction: "left" } },
      { id: "B", shots: [{ id: "shB", reveals: [mk("rB", "tb", "B", 100)] }], exitTransition: { type: "cut-the-curve", direction: "up" } },
      { id: "C", shots: [{ id: "shC", reveals: [mk("rC", "tc", "C", 200)] }] },
    ]
    const { plan } = bakeShotSequence(b, [], "https://r2/vo.mp3")
    const [, B] = plan.scenes
    expect(B.transitionInDirection).toBe("left") // inherited from A's exit
    expect(B.transitionOutDirection).toBe("up") // B's own exit — independently authored, legitimately different
  })

  it("cut-the-curve: omitting exitTransition everywhere produces a byte-identical plan to the plain-crossfade baseline", () => {
    const b = brief()
    b.narration = { script: "a b c", cues: [{ id: "c1", text: "a" }] }
    const mk = (id: string, tid: string, text: string, frame: number): BriefReveal => ({
      id, element: { id: tid, type: "text", text, fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 },
      revealAt: { kind: "frame", frame }, enter: { motion: "fade", durationFrames: 6 },
    })
    b.scenes = [
      { id: "A", shots: [{ id: "shA", reveals: [mk("rA", "ta", "A", 0)] }] },
      { id: "B", shots: [{ id: "shB", reveals: [mk("rB", "tb", "B", 100)] }] },
      { id: "C", shots: [{ id: "shC", reveals: [mk("rC", "tc", "C", 200)] }] },
    ]
    const { plan } = bakeShotSequence(b, [], "https://r2/vo.mp3")
    // Identical brief/scenes to the existing "emits scene cross-dissolve frames" test above,
    // just re-asserted here as the explicit regression gate for this phase's schema additions —
    // no transitionType/Direction field appears anywhere when exitTransition is never authored.
    for (const scene of plan.scenes) {
      expect((scene as Record<string, unknown>).transitionInType).toBeUndefined()
      expect((scene as Record<string, unknown>).transitionInDirection).toBeUndefined()
      expect((scene as Record<string, unknown>).transitionOutType).toBeUndefined()
      expect((scene as Record<string, unknown>).transitionOutDirection).toBeUndefined()
    }
    const [A, B, C] = plan.scenes
    expect(A.transitionOutFrames).toBe(4)
    expect(B.transitionInFrames).toBe(3)
    expect(B.transitionOutFrames).toBe(4)
    expect(C.transitionInFrames).toBe(3)
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

  // ── Blueprint reveals ──────────────────────────────────────────────────

  it("bakes a blueprint reveal using defaultDurationFrames when durationFrames is absent", () => {
    // titlecard-reveal defaultDurationFrames = 120
    const b = brief()
    b.scenes[0].shots[0].reveals = [
      {
        id: "bp1",
        blueprint: { id: "titlecard-reveal", params: { title: "X" } },
        revealAt: { kind: "frame", frame: 100 },
      } as never,
    ]
    b.narration.cues = [{ id: "c1", text: "ship" }] // unused by reveals
    const { plan } = bakeShotSequence(b, [], "https://r2/vo.mp3")
    const rev = plan.scenes[0].shots[0].reveals[0] as Record<string, unknown>
    expect((rev.blueprint as Record<string, unknown>).id).toBe("titlecard-reveal")
    expect(rev.frame).toBe(0) // rebased: 100 - 100 = 0
    expect(rev.durationFrames).toBe(120) // default
    expect(rev.revealAt).toBeUndefined() // stripped
    expect(rev.element).toBeUndefined() // no element on a blueprint reveal
    // composition: endAbs = 100 + 120 = 220; tail = fps(30) = 30 → max(220, 0+30) = 220
    expect(plan.durationInFrames).toBe(220)
  })

  it("honors an explicit durationFrames on a blueprint reveal", () => {
    const b = brief()
    b.scenes[0].shots[0].reveals = [
      {
        id: "bp2",
        blueprint: { id: "titlecard-reveal", params: { title: "X" } },
        revealAt: { kind: "frame", frame: 0 },
        durationFrames: 90,
      } as never,
    ]
    b.narration.cues = [{ id: "c1", text: "ship" }]
    const { plan } = bakeShotSequence(b, [], "https://r2/vo.mp3")
    const rev = plan.scenes[0].shots[0].reveals[0] as Record<string, unknown>
    expect(rev.durationFrames).toBe(90)
    // With no narration: durationInFrames = max(tail=30, endAbs=90) = 90
    // (the tail only applies to the narration-based estimate, not on top of maxSceneEnd)
    expect(plan.durationInFrames).toBe(90)
  })

  it("bakes both element and blueprint reveals in one scene without conflict", () => {
    const b = brief()
    b.scenes[0].shots[0].reveals = [
      { id: "el1", element: { id: "t1", type: "text", text: "Hi", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "frame", frame: 0 }, enter: { motion: "fade", durationFrames: 6 } },
      { id: "bp3", blueprint: { id: "titlecard-reveal", params: { title: "Y" } }, revealAt: { kind: "frame", frame: 50 } } as never,
    ]
    b.narration.cues = [{ id: "c1", text: "ship" }]
    const { plan } = bakeShotSequence(b, [], "https://r2/vo.mp3")
    const reveals = plan.scenes[0].shots[0].reveals as Record<string, unknown>[]
    expect(reveals).toHaveLength(2)
    const elRev = reveals.find((r) => r.id === "el1")!
    const bpRev = reveals.find((r) => r.id === "bp3")!
    expect(elRev.element).toBeDefined()
    expect(elRev.enter).toBeDefined()
    expect(bpRev.blueprint).toBeDefined()
    expect(bpRev.durationFrames).toBe(120) // default
    expect(elRev.revealAt).toBeUndefined()
    expect(bpRev.revealAt).toBeUndefined()
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
