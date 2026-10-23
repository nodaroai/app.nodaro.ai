/**
 * Kling 4.0 request bodies — pure, no I/O.
 *
 * Two KIE endpoints, two Nodaro ids:
 *   - `kling-4`           → `kling-4.0/reference-to-video`
 *     (docs.kie.ai/market/kling/v4-reference-to-video)
 *   - `kling-4-keyframes` → `kling-4.0/keyframe-to-video`
 *     (docs.kie.ai/market/kling/v4-keyframe-to-video)
 *
 * Both schemas are `additionalProperties: false`, so each body is an explicit
 * allow-list: integer `duration`, lowercase `resolution`, no seed, no negative
 * prompt.
 *
 * NAMES. Kling addresses every material by an `@` name in the prompt, and KIE
 * REFUSES a prompt that names a material the request does not carry (live,
 * 2026-10-23: 422 "prompt references undeclared material @image_1"). The
 * platform writes its own numbering — `@image_N` for reference images (frames
 * demoted into them included), `@video_N`, `@audio_N` — and binds wired
 * characters to the `@image_N` seat their image occupies. This module is the ONE
 * place that numbering becomes Kling's:
 *   - reference: a character seat becomes the subject's `@Name`, the remaining
 *     images renumber, `@audio_N` becomes the voice's `@VoiceN`;
 *   - keyframes: `@image_N` becomes `@keyframe_N`;
 * and then every `@word` the body does not declare loses its `@`, so no path
 * — editor, workflow, API, MCP — can reach the 422.
 */
import type { VideoCharacterReference } from "@nodaro/shared/video"
import { kling4KeyframeFrameCap, KLING_4_MAX_MIDDLE_FRAMES, normalizeKling4Resolution } from "@nodaro/shared/models"
import { placeFramesAfterReferences } from "@nodaro/prompts/assembly"

import { KLING_4_REFERENCE_MODEL, KLING_4_KEYFRAME_MODEL } from "./models.js"

/** KIE caps (reference-to-video). */
const MAX_IMAGES = 10
const MAX_VIDEOS = 5
const MAX_SUBJECTS = 7
const MAX_VOICES = 3
const MAX_SUBJECT_IMAGES = 4
const SUBJECT_DESCRIPTION_MAX = 100
const NAME_MAX = 20

const KLING_4_ASPECTS = new Set(["auto", "16:9", "9:16", "1:1", "21:9"])

/** Names KIE reserves for its own materials (case-insensitive, N a number). */
const RESERVED_NAME = /^(image|video|keyframe|object|audio)_\d+$|^(first|last)_frame$/i

export interface Kling4RequestArgs {
  provider: "kling-4" | "kling-4-keyframes"
  prompt: string
  /** Already snapped to 3..30. */
  durationSec: number
  resolution?: string
  aspectRatio?: string
  startFrameUrl?: string
  endFrameUrl?: string
  referenceImageUrls?: readonly string[]
  referenceVideoUrls?: readonly string[]
  referenceAudioUrls?: readonly string[]
  characterReferences?: readonly VideoCharacterReference[]
  keepOriginalSound?: boolean
}

export interface Kling4Request {
  model: string
  input: Record<string, unknown>
  /** What the builder had to drop or change, for the run log. */
  notes: string[]
}

/** A Kling subject/voice name: 1-20 of [A-Za-z0-9_] or CJK, never reserved. */
export function kling4Name(raw: string | undefined, fallback: string): string {
  let name = (raw ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^一-龥A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, NAME_MAX)
  if (!name) name = fallback
  if (RESERVED_NAME.test(name)) name = `${name.slice(0, NAME_MAX - 2)}_x`
  return name
}

/** Make `name` unique (case-insensitive) against `taken`, within 20 chars. */
function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = String(n)
    candidate = `${name.slice(0, NAME_MAX - suffix.length)}${suffix}`
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Rewrite `@<prefix>_N` tokens through `map` (N → replacement name, or absent). */
function renumber(prompt: string, prefix: string, map: (n: number) => string | undefined): string {
  return prompt.replace(new RegExp(`@${prefix}_(\\d+)(?![\\w\\u4e00-\\u9fa5])`, "g"), (whole, digits: string) => {
    const name = map(Number(digits))
    return name === undefined ? whole : `@${name}`
  })
}

/**
 * Drop the `@` from every mention the request does not declare. A mention is
 * `@` followed by name characters; it is valid only when those characters are
 * EXACTLY a declared name (KIE's longest-match rule also forbids a name
 * followed by another name character).
 */
export function neutralizeUndeclaredMentions(prompt: string, declared: readonly string[]): string {
  const byLower = new Map(declared.map((d) => [d.toLowerCase(), d]))
  return prompt.replace(/@([一-龥A-Za-z0-9_]+)/g, (_whole, word: string) => {
    const hit = byLower.get(word.toLowerCase())
    return hit !== undefined ? `@${hit}` : word
  })
}

/** Every `@name` mention left in a prompt — the guard tests read this. */
export function kling4Mentions(prompt: string): string[] {
  return [...prompt.matchAll(/@([一-龥A-Za-z0-9_]+)/g)].map((m) => m[1]!)
}

const cleanList = (xs: readonly string[] | undefined): string[] =>
  (xs ?? []).map((u) => u?.trim()).filter((u): u is string => !!u)

function withPromptSuffix(prompt: string, suffix: string): string {
  return suffix ? (prompt.trim() ? `${prompt}\n\n${suffix}` : suffix) : prompt
}

export function buildKling4Request(args: Kling4RequestArgs): Kling4Request {
  return args.provider === "kling-4-keyframes" ? buildKeyframes(args) : buildReference(args)
}

function buildKeyframes(args: Kling4RequestArgs): Kling4Request {
  const notes: string[] = []
  const first = args.startFrameUrl?.trim() || undefined
  const last = args.endFrameUrl?.trim() || undefined
  const frameCap = kling4KeyframeFrameCap(args.durationSec)
  const middleCap = Math.min(KLING_4_MAX_MIDDLE_FRAMES, frameCap - (first ? 1 : 0) - (last ? 1 : 0))
  const allMiddle = cleanList(args.referenceImageUrls)
  const middle = allMiddle.slice(0, Math.max(0, middleCap))
  if (middle.length < allMiddle.length) {
    notes.push(`dropped ${allMiddle.length - middle.length} in-between frame(s): ${args.durationSec}s takes ${frameCap} frames in all`)
  }

  let prompt = renumber(args.prompt, "image", (n) => (n >= 1 && n <= middle.length ? `keyframe_${n}` : undefined))
  const declared = [
    ...(first ? ["first_frame"] : []),
    ...middle.map((_, i) => `keyframe_${i + 1}`),
    ...(last ? ["last_frame"] : []),
  ]
  prompt = neutralizeUndeclaredMentions(prompt, declared)

  const input: Record<string, unknown> = {
    prompt,
    duration: args.durationSec,
    resolution: normalizeKling4Resolution(args.resolution),
  }
  if (first) input.first_frame_url = first
  if (middle.length > 0) input.keyframe_urls = middle
  if (last) input.last_frame_url = last
  // The ratio applies only when no frame is attached (the output follows the
  // first frame otherwise).
  const aspect = args.aspectRatio?.trim()
  if (!first && middle.length === 0 && !last && aspect && KLING_4_ASPECTS.has(aspect)) input.aspect_ratio = aspect
  return { model: KLING_4_KEYFRAME_MODEL, input, notes }
}

interface Subject {
  name: string
  /** Every name the caller may have written it under (its raw name). */
  rawName?: string
  imageUrls: string[]
  description?: string
}

function buildReference(args: Kling4RequestArgs): Kling4Request {
  const notes: string[] = []
  const taken = new Set<string>()

  // Frames cannot ride this endpoint as frames: they join the reference images
  // after the caller's own and are named in a prompt sentence (the platform
  // rule shared with Wan 3.0 / Vidu Q4).
  const placed = placeFramesAfterReferences({
    prompt: args.prompt,
    firstFrameUrl: args.startFrameUrl?.trim() || undefined,
    lastFrameUrl: args.endFrameUrl?.trim() || undefined,
    refImageUrls: cleanList(args.referenceImageUrls),
    imageCap: MAX_IMAGES,
  })
  if (placed.droppedRefImages > 0) notes.push(`dropped ${placed.droppedRefImages} reference image(s) to fit ${MAX_IMAGES}`)
  let prompt = withPromptSuffix(args.prompt, placed.promptSuffix)
  const seated = placed.imageUrls

  // Subjects: a character with 2-4 images becomes a Kling subject; one with a
  // single image stays a reference image.
  const subjects: Subject[] = []
  const singleImageRefs: Array<{ rawName?: string; url: string }> = []
  for (const ref of (args.characterReferences ?? []).slice(0, MAX_SUBJECTS)) {
    const images = [...new Set(cleanList([ref.imageUrl, ref.bodyImageUrl ?? "", ...(ref.extraImageUrls ?? [])]))]
      .slice(0, MAX_SUBJECT_IMAGES)
    if (images.length === 0) continue
    if (images.length < 2) {
      singleImageRefs.push({ rawName: ref.name, url: images[0]! })
      continue
    }
    subjects.push({
      name: uniqueName(kling4Name(ref.name, `Character${subjects.length + 1}`), taken),
      rawName: ref.name,
      imageUrls: images,
      description: ref.description?.trim().slice(0, SUBJECT_DESCRIPTION_MAX) || undefined,
    })
  }

  // A seat whose image belongs to a subject IS that subject: its `@image_N`
  // becomes `@Name`, and the image leaves the list.
  const subjectByUrl = new Map<string, Subject>()
  for (const s of subjects) for (const u of s.imageUrls) if (!subjectByUrl.has(u)) subjectByUrl.set(u, s)
  const images: string[] = []
  const seatName = new Map<number, string>()
  seated.forEach((url, i) => {
    const subject = subjectByUrl.get(url)
    if (subject) {
      seatName.set(i + 1, subject.name)
    } else {
      images.push(url)
      seatName.set(i + 1, `image_${images.length}`)
    }
  })
  prompt = renumber(prompt, "image", (n) => seatName.get(n))
  // A single-image character the platform did not already seat joins the
  // images (after the renumbering, so its seat is final); its name in the
  // prompt points at that seat.
  for (const single of singleImageRefs) {
    let index = images.indexOf(single.url)
    if (index === -1 && images.length < MAX_IMAGES) {
      images.push(single.url)
      index = images.length - 1
    }
    if (index !== -1 && single.rawName?.trim()) {
      prompt = prompt.replace(new RegExp(`@${escapeRe(single.rawName.trim())}(?![\\w\\u4e00-\\u9fa5])`, "gi"), `@image_${index + 1}`)
    }
  }
  // A caller writing the subject's raw name ("@Maya Lee") gets its Kling name.
  for (const s of subjects) {
    const raw = s.rawName?.trim()
    if (raw && raw !== s.name) {
      prompt = prompt.replace(new RegExp(`@${escapeRe(raw)}(?![\\w\\u4e00-\\u9fa5])`, "gi"), `@${s.name}`)
    }
  }

  const videos = cleanList(args.referenceVideoUrls).slice(0, MAX_VIDEOS)
  const audio = cleanList(args.referenceAudioUrls).slice(0, MAX_VOICES)
  const voices = audio.map((url, i) => ({ name: uniqueName(`Voice${i + 1}`, taken), audio_url: url }))
  prompt = renumber(prompt, "audio", (n) => voices[n - 1]?.name)

  const declared = [
    ...images.map((_, i) => `image_${i + 1}`),
    ...videos.map((_, i) => `video_${i + 1}`),
    ...subjects.map((s) => s.name),
    ...voices.map((v) => v.name),
  ]
  prompt = neutralizeUndeclaredMentions(prompt, declared)

  const input: Record<string, unknown> = {
    prompt,
    duration: args.durationSec,
    resolution: normalizeKling4Resolution(args.resolution),
  }
  const aspect = args.aspectRatio?.trim()
  if (aspect && KLING_4_ASPECTS.has(aspect)) input.aspect_ratio = aspect
  if (images.length > 0) input.image_urls = images
  if (videos.length > 0) {
    input.video_urls = videos
    input.keep_original_sound = args.keepOriginalSound === true
  }
  if (subjects.length > 0) {
    input.elements = subjects.map((s) => ({
      name: s.name,
      image_urls: s.imageUrls,
      tag: "character",
      ...(s.description ? { description: s.description } : {}),
    }))
  }
  if (voices.length > 0) input.voices = voices
  return { model: KLING_4_REFERENCE_MODEL, input, notes }
}
