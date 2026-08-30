/**
 * The reference-binding surface string — `@image_N` / `@video_N` / `@audio_N`
 * — and the one identity sentence built on it. Split out of
 * `video-reference-resolver.ts` so the id-addressed token resolver
 * (`ref-id-tokens.ts`) can bind through the same arrows without a module
 * cycle; the resolver re-exports both, so importers are unaffected.
 */

/**
 * The SINGLE swap-point for the reference-binding surface-string (design D1/D7).
 *
 * Every place that renders an `@image_N`-style binding into a video prompt — the
 * per-image subject phrasing, the bare ordinal in a "Use these characters" /
 * pair-back bullet, and the opening/closing frame directive — MUST go through
 * these five arrows. The default form is `@image_N`; if the D7 probe shows a
 * provider prefers the legacy `Image N` form, flipping is editing ONLY these five
 * arrows (`@image_${n}` → `Image ${n}`), nothing downstream.
 *
 * This IS the live swap-point: `resolveVideoReferenceCore` routes the per-image
 * subject phrasing, the "Use these characters" / pair-back bullet ordinals, and
 * the frame directive through these arrows, and `resolveReferenceTokens` resolves
 * the body `{image:N}` tokens through `REF_BINDING[kind]` — so the five arrows
 * are the ONLY emission sites for the binding surface string.
 */
/**
 * The identity-reference binding sentence shared by the flat-image-list
 * resolvers (gemini-omni, veo i2v): names the ordinal span as identities and
 * says the two things a multimodal model needs to hear — match exactly, and
 * these are not frames. One spelling; both resolvers ride it.
 */
export function identityRefsSentence(firstOrdinal: number, lastOrdinal: number): string {
  return firstOrdinal === lastOrdinal
    ? `${REF_BINDING.ordinal(firstOrdinal)} is an identity reference for this shot's subjects — match its subject's exact appearance; it is not a frame.`
    : `${REF_BINDING.ordinal(firstOrdinal)} through ${REF_BINDING.ordinal(lastOrdinal)} are identity references for this shot's subjects — match each subject's exact appearance; they are not frames.`
}

export const REF_BINDING = {
  image: (label: string, n: number) => `the ${label} from @image_${n}`,
  video: (label: string, n: number) => `the ${label} from @video_${n}`,
  audio: (label: string, n: number) => `the ${label} from @audio_${n}`,
  /** ordinal as it appears in a "Use these characters" bullet / pair-back */
  ordinal: (n: number) => `@image_${n}`,
  frame: (n: number, role: "opening" | "closing") =>
    `Use @image_${n} as the ${role} (${role === "opening" ? "first" : "last"}) frame of the video.`,
} as const
