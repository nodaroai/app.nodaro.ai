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
export function identityRefsSentence(
  firstOrdinal: number,
  lastOrdinal: number,
  ordinal: (n: number) => string = REF_BINDING.ordinal,
): string {
  return firstOrdinal === lastOrdinal
    ? `${ordinal(firstOrdinal)} is an identity reference for this shot's subjects — match its subject's exact appearance; it is not a frame.`
    : `${ordinal(firstOrdinal)} through ${ordinal(lastOrdinal)} are identity references for this shot's subjects — match each subject's exact appearance; they are not frames.`
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

/** A binding sentence's ordinal + frame directive in one provider syntax. */
export interface ImageBinding {
  ordinal: (n: number) => string
  frame: (n: number, role: "opening" | "closing") => string
}

/**
 * The image binding in a provider's OWN reference syntax
 * (`videoProviderReferenceSyntax` in @nodaro/shared). `@image_N` IS
 * {@link REF_BINDING} — the platform swap point, byte for byte; the other two
 * spell the same sentence in the form the provider documents.
 */
export function imageBindingFor(syntax: "@image_N" | "@image(n)" | "[Image N]"): ImageBinding {
  if (syntax === "@image_N") return { ordinal: REF_BINDING.ordinal, frame: REF_BINDING.frame }
  const ordinal = syntax === "@image(n)" ? (n: number) => `@image(${n})` : (n: number) => `[Image ${n}]`
  return {
    ordinal,
    frame: (n, role) => `Use ${ordinal(n)} as the ${role} (${role === "opening" ? "first" : "last"}) frame of the video.`,
  }
}

/**
 * The instruction that makes Seedance EDIT a wired clip rather than use it as a
 * style reference — the Video to Video node's Seedance lane prepends it to the
 * user's own sentence. Written with the EDITOR token (`{video:1}`) so it goes
 * through the same reference resolver as any prompt: the source clip is the
 * run's first reference video, so it resolves to `@video_1` on the wire. The
 * instruction lands on its own line after it.
 */
export const SEEDANCE_VIDEO_EDIT_PREFIX = "edit {video:1} as follows:\n"

/** The user's sentence, framed as an edit of the source clip. Idempotent: a
 *  prompt that already opens with the instruction (a preset's pre text, a
 *  hand-written one, either token spelling) is left alone. */
export function buildSeedanceVideoEditPrompt(prompt: string | undefined): string {
  const body = (prompt ?? "").trim()
  if (/^edit\s+(?:\{video:1(?::[^}]*)?\}|@video_1(?!\w))/i.test(body)) return body
  return `${SEEDANCE_VIDEO_EDIT_PREFIX}${body}`
}
