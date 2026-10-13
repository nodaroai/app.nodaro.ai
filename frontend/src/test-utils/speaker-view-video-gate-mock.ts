/**
 * Runs Speaker View's video-mode gate (R15) at a chosen pair of price flags in
 * a test. The gate's functions read their module's own flags, so a test that
 * stands in for `SPEAKER_VIEW_PRICED` alone leaves them on the real pair; this
 * wraps every exported gate site so it reads the pair the test sets:
 *
 *   const flag = vi.hoisted(() => ({ priced: true, frames: true }))
 *   vi.mock("@nodaro/render-rules", async (orig) =>
 *     (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await orig(), flag))
 */
import type * as RenderRules from "@nodaro/render-rules"

/** `priced`: Speaker View's flag; `frames`: Speaker Frames'. */
export interface VideoGatePair {
  priced: boolean
  frames: boolean
}

export function withVideoGate<T extends typeof RenderRules>(actual: T, pair: VideoGatePair): T {
  const flags = (f: RenderRules.SpeakerViewVideoGateFlags = {}): RenderRules.SpeakerViewVideoGateFlags => ({
    viewPriced: pair.priced,
    framesPriced: pair.frames,
    ...f,
  })
  return {
    ...actual,
    get SPEAKER_VIEW_PRICED() {
      return pair.priced
    },
    get SPEAKER_FRAMES_PRICED() {
      return pair.frames
    },
    speakerViewVideoModeLive: (f?: RenderRules.SpeakerViewVideoGateFlags) => actual.speakerViewVideoModeLive(flags(f)),
    speakerViewVideoModeRefusal: (f?: RenderRules.SpeakerViewVideoGateFlags) => actual.speakerViewVideoModeRefusal(flags(f)),
    speakerViewVideoRunRefusal: (...args: Parameters<T["speakerViewVideoRunRefusal"]>) =>
      actual.speakerViewVideoRunRefusal(args[0], args[1], args[2], flags(args[3])),
  }
}
