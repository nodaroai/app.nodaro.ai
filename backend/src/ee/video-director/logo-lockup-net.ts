import type { BrandTokens } from "@nodaro/shared"
import type { ShotSequenceBrief } from "../../services/shot-sequence/brief-schema.js"

/**
 * Guarantee the logo image is shown: if the brand supplies a logo image but the
 * authored brief has no `logo-assemble-lockup` reveal, append a trailing
 * branding scene with one, anchored to the LAST cue's end (so it plays as the
 * narration finishes). Identity in every other case (byte-identical when no
 * logo image). Pure — no deps, unit-testable.
 *
 * Scope: this net is applied by the video-director orchestrator only (see
 * `orchestrate.ts`) — it is NOT invoked by the `resolve_shot_sequence` /
 * `render_shot_sequence` route or MCP tools, which call `bakeShotSequence`
 * directly. Callers of those APIs must include a `logo-assemble-lockup`
 * reveal themselves if they want the logo shown.
 *
 * The `brand` arg is intentionally the CALLER-resolved brand (what
 * `orchestrate.ts` passes as `resolvedBrand`), NOT `brief.brandTokens` — the
 * v1 guarantee is caller-brand-driven. Do not "simplify" this to read
 * `brief.brandTokens`: that would silently change the contract to also fire on
 * an author-emitted brand with no caller brand.
 */
export function ensureLogoLockupScene(brief: ShotSequenceBrief, brand: BrandTokens | undefined): ShotSequenceBrief {
  if (!brand?.logo?.image) return brief
  const { logo } = brand
  const hasLockup = brief.scenes.some((s) =>
    s.shots.some((sh) => sh.reveals.some((r) => r.blueprint?.id === "logo-assemble-lockup")),
  )
  if (hasLockup) return brief
  const cues = brief.narration.cues
  if (cues.length === 0) return brief
  const lastCue = cues[cues.length - 1]
  const appended = {
    id: "scene-logo-lockup",
    shots: [
      {
        id: "shot-logo-lockup",
        reveals: [
          {
            id: "rv-logo-lockup",
            // +100ms past the last cue's end (imperceptible — this is still
            // "as the narration finishes"). Without it, an authored closing
            // reveal that ALSO anchors to {lastCue, edge:"end"} (a common
            // CTA-holds-to-the-end pattern) ties frameAbs with this appended
            // scene; the baker's overlap guard then hard-rejects the tie
            // instead of applying its normal "clamp the previous scene's tail"
            // recovery (that recovery only fires when the earlier scene's OWN
            // anchor frame is strictly before this scene's start). 100ms
            // guarantees >=1 frame of separation even at the schema's lowest
            // fps floor (15fps => 66.7ms/frame), which is enough for the
            // clamp to trim the previous scene's tail instead of erroring.
            // Verified against the real baker in
            // logo-lockup-net-bake-integration.test.ts.
            revealAt: { kind: "cue" as const, cueId: lastCue.id, edge: "end" as const, offsetMs: 100 },
            blueprint: {
              id: "logo-assemble-lockup",
              params: {
                brand: logo.name,
                ...(logo.tagline ? { tagline: logo.tagline } : {}),
                accentColor: brand.palette.accent,
              },
            },
            durationFrames: 180,
          },
        ],
      },
    ],
  }
  return { ...brief, scenes: [...brief.scenes, appended] } as ShotSequenceBrief
}
