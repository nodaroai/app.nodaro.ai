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

/** How a video provider addresses its images in the prompt, by array order
 *  (`VideoReferenceSyntax` in @nodaro/shared). */
export type ImageReferenceSyntax = "@image_N" | "@image(n)" | "[Image N]" | "image N"

/** The binding sentences — frames and identity references — in one provider syntax. */
export interface ImageBinding {
  ordinal: (n: number) => string
  /** One frame: the opening or the closing one. */
  frame: (n: number, role: "opening" | "closing") => string
  /** A start and an end frame together. */
  frames: (first: number, last: number) => string
  /** Seats `first`..`last` are references, not frames. */
  identities: (first: number, last: number) => string
}

const roleWords = (role: "opening" | "closing") => `${role} (${role === "opening" ? "first" : "last"})`

/** "image 1", "image 1 and image 2", "image 1, image 2 and image 3". */
function plainList(first: number, last: number): string {
  const names = Array.from({ length: last - first + 1 }, (_, i) => `image ${first + i}`)
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/**
 * The image binding in a provider's OWN reference syntax
 * (`videoProviderReferenceSyntax` in @nodaro/shared). `@image_N` IS
 * {@link REF_BINDING} — the platform swap point, byte for byte; `@image(n)` and
 * `[Image N]` spell the same sentences in the form the provider documents.
 *
 * `image N` (Gemini Omni Flash 1.2) is plain words, each sentence stating what
 * an image IS: "image 3 is the opening (first) frame of the video. image 1 and
 * image 2 are references for the subject; they are not frames." That exact
 * wording put a start frame beside two references on screen as the opening
 * frame in a staging run, where the `@image_N` sentences opened on a reference.
 */
export function imageBindingFor(syntax: ImageReferenceSyntax): ImageBinding {
  if (syntax === "image N") {
    return {
      ordinal: (n) => `image ${n}`,
      frame: (n, role) => `image ${n} is the ${roleWords(role)} frame of the video.`,
      frames: (first, last) => `image ${first} is the ${roleWords("opening")} frame and image ${last} is the ${roleWords("closing")} frame of the video.`,
      identities: (first, last) => first === last
        ? `image ${first} is a reference for the subject; it is not a frame.`
        : `${plainList(first, last)} are references for the subject; they are not frames.`,
    }
  }
  const ordinal = syntax === "@image_N"
    ? REF_BINDING.ordinal
    : syntax === "@image(n)" ? (n: number) => `@image(${n})` : (n: number) => `[Image ${n}]`
  return {
    ordinal,
    frame: syntax === "@image_N" ? REF_BINDING.frame : (n, role) => `Use ${ordinal(n)} as the ${roleWords(role)} frame of the video.`,
    frames: (first, last) => `Use ${ordinal(first)} as the ${roleWords("opening")} frame and ${ordinal(last)} as the ${roleWords("closing")} frame of the video.`,
    identities: (first, last) => identityRefsSentence(first, last, ordinal),
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
