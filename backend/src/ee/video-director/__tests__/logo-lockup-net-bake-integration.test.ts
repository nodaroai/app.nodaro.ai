// Integration regression guard: ensureLogoLockupScene() is a pure function
// tested in isolation in logo-lockup-net.test.ts, but its output is only
// useful if the REAL baker accepts it. A very plausible authoring pattern —
// the director's closing CTA reveal ALSO anchored to {lastCue, edge:"end"}
// (holding the CTA through to the end of narration) — ties frameAbs with the
// net's appended lockup scene. Without the +100ms offset on the appended
// anchor, the baker's overlap guard hard-rejects that tie instead of applying
// its normal "clamp the earlier scene's tail" recovery (which only fires when
// the earlier scene's own anchor frame is strictly before the next scene's
// start — see bakeShotSequence step 2.5 in baker.ts). This file proves both
// that the offset resolves the real scenario and that removing it reintroduces
// the failure, so a future edit that drops the offset as "unnecessary" is
// caught here rather than in production.
import { describe, it, expect } from "vitest"
import type { BrandTokens } from "@nodaro/shared"
import { ensureLogoLockupScene } from "../logo-lockup-net.js"
import { bakeShotSequence, SceneOverlapError } from "../../../services/shot-sequence/baker.js"
import type { ShotSequenceBrief } from "../../../services/shot-sequence/brief-schema.js"
import type { AlignmentWord } from "../../../providers/elevenlabs/forced-alignment.js"
import { brief } from "../../../services/shot-sequence/__tests__/baker-fixtures.js"

const brandWithLogo: BrandTokens = {
  palette: { bg: "#000", text: "#fff", accent: "#0af" },
  fonts: { heading: "Anton", body: "Inter" },
  logo: { name: "Acme", tagline: "Go", image: "https://cdn/x.png" },
}

// "hello" -> 0..0.5s, "world" -> 0.5..1.0s
const alignment: AlignmentWord[] = [
  { word: "hello", start: 0, end: 0.5 },
  { word: "world", start: 0.5, end: 1.0 },
]

function worstCaseBrief(): ShotSequenceBrief {
  return brief({
    width: 1080,
    height: 1920,
    narration: { script: "hello world", cues: [{ id: "c1", text: "hello" }, { id: "c2", text: "world" }] },
    scenes: [
      {
        id: "s1",
        shots: [{ id: "sh1", reveals: [
          { id: "r1", revealAt: { kind: "cue", cueId: "c1", edge: "start" }, blueprint: { id: "kinetic-type-beats", params: { lines: ["hi"] } }, durationFrames: 120 },
        ] }],
      },
      {
        id: "s2",
        shots: [{ id: "sh2", reveals: [
          // The director's own CTA holds THROUGH the end of narration — the
          // same anchor point the net uses for the appended lockup scene.
          { id: "r2", revealAt: { kind: "cue", cueId: "c2", edge: "end" }, blueprint: { id: "cta-morph-press", params: { label: "Go" } }, durationFrames: 150 },
        ] }],
      },
    ],
  })
}

describe("ensureLogoLockupScene output vs the real bakeShotSequence", () => {
  it("bakes cleanly when the closing CTA ties the same {lastCue, edge:end} anchor", () => {
    const brief = worstCaseBrief()
    const withLockup = ensureLogoLockupScene(brief, brandWithLogo)
    expect(withLockup.scenes).toHaveLength(3) // sanity: net actually appended

    const { plan } = bakeShotSequence(withLockup, alignment, "https://cdn/audio.mp3")
    expect(plan.scenes.map((s) => s.id)).toEqual(["s1", "s2", "scene-logo-lockup"])
    // The previous (CTA) scene's tail correctly trims to abut the lockup scene
    // (the baker's recoverable-tail clamp), rather than throwing.
    const s2 = plan.scenes.find((s) => s.id === "s2")!
    const lockup = plan.scenes.find((s) => s.id === "scene-logo-lockup")!
    expect(s2.startFrame + s2.durationInFrames).toBe(lockup.startFrame)
  })

  it("documents why the offset is load-bearing: without it, the same scenario throws SceneOverlapError", () => {
    const brief = worstCaseBrief()
    const withLockup = ensureLogoLockupScene(brief, brandWithLogo)
    // Strip the offsetMs the net adds, to simulate the pre-fix anchor and
    // prove the failure is real (not merely theoretical) and specifically
    // attributable to the offset, not some other property of the appended scene.
    const noOffsetVariant: typeof withLockup = {
      ...withLockup,
      scenes: withLockup.scenes.map((s, i) =>
        i === withLockup.scenes.length - 1
          ? {
              ...s,
              shots: s.shots.map((sh) => ({
                ...sh,
                reveals: sh.reveals.map((r) => ({
                  ...r,
                  revealAt: r.revealAt.kind === "cue" ? { ...r.revealAt, offsetMs: undefined } : r.revealAt,
                })),
              })),
            }
          : s,
      ),
    }
    expect(() => bakeShotSequence(noOffsetVariant, alignment, "https://cdn/audio.mp3")).toThrow(SceneOverlapError)
  })
})
