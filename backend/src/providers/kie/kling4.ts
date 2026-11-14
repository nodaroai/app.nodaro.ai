/**
 * Kling 4.0 request bodies — pure, no I/O.
 *
 * Four KIE endpoints, three Nodaro ids:
 *   - `kling-4`           → `kling-4.0/reference-to-video`
 *     (docs.kie.ai/market/kling/v4-reference-to-video)
 *   - `kling-4-keyframes` → `kling-4.0/keyframe-to-video`
 *     (docs.kie.ai/market/kling/v4-keyframe-to-video)
 *   - `kling-4-flash`     → `kling-4.0/flash-keyframe-to-video` for a start
 *     frame alone, `kling-4.0/flash-reference-to-video` for everything else
 *     ({@link kling4FlashEndpoint}; docs.kie.ai/market/kling/v4-flash-*)
 *
 * Every schema is `additionalProperties: false`, so each body is an explicit
 * allow-list: integer `duration`, lowercase `resolution`, no seed, no negative
 * prompt. Flash adds: 720p only, no end frame, no `voices` (a reference audio
 * clip is a subject's `voice_url`), no in-between frames.
 *
 * NAMES. Kling addresses every material by an `@` name in the prompt, and KIE
 * REFUSES a prompt that names a material the request does not carry (live,
 * 2026-10-23: 422 "prompt references undeclared material @image_1"). The
 * platform writes its own numbering — `@image_N` for reference images (frames
 * demoted into them included), `@video_N`, `@audio_N` — and binds wired
 * characters to the `@image_N` seat their image occupies. This module is the ONE
 * place that numbering becomes Kling's:
 *   - reference: a character seat becomes the subject's `@Name`, the remaining
 *     images renumber, `@audio_N` becomes the voice's `@VoiceN`; a character's
 *     clip seated among the reference videos (a video subject) does the same:
 *     its `@video_N` becomes `@Name` and the remaining videos renumber;
 *   - keyframes: `@image_N` becomes `@keyframe_N`;
 * and then every `@word` the body does not declare loses its `@`, so no path
 * — editor, workflow, API, MCP — can reach the 422.
 */
import type { VideoCharacterReference } from "@nodaro/shared/video"
import { kling4KeyframeFrameCap, KLING_4_MAX_MIDDLE_FRAMES, normalizeKling4Resolution, KLING_4_FLASH_RESOLUTION } from "@nodaro/shared/models"
import { placeFramesAfterReferences } from "@nodaro/prompts/assembly"

import {
  KLING_4_REFERENCE_MODEL,
  KLING_4_KEYFRAME_MODEL,
  KLING_4_FLASH_REFERENCE_MODEL,
  KLING_4_FLASH_KEYFRAME_MODEL,
} from "./models.js"

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
  provider: "kling-4" | "kling-4-keyframes" | "kling-4-flash"
  prompt: string
  /** Already snapped to the model's durations (3..30; Flash 3..20). */
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
  if (args.provider === "kling-4-flash") return buildFlash(args)
  return args.provider === "kling-4-keyframes" ? buildKeyframes(args) : buildReference(args)
}

/** A character reference with a clip or at least one usable image (it reaches
 *  the reference endpoint as a subject, or as a reference image when it has
 *  one image only). */
const hasCharacterImage = (ref: VideoCharacterReference): boolean =>
  !!ref.videoUrl?.trim() || cleanList([ref.imageUrl, ref.bodyImageUrl ?? "", ...(ref.extraImageUrls ?? [])]).length > 0

/**
 * Which Kling 4.0 Flash endpoint a run takes (decided 2026-11-11): a start
 * frame with no reference image, no reference video and no character runs on
 * the KEYFRAME endpoint, where the frame is the exact opening frame. Anything
 * else — plain text, references, characters, or a start frame beside any of
 * them — runs on the REFERENCE endpoint, where a start frame joins the
 * reference images (as on `kling-4`). Reference audio does not decide it: with
 * no character to carry it, a clip has nowhere to go on either endpoint.
 */
export function kling4FlashEndpoint(args: Pick<Kling4RequestArgs, "startFrameUrl" | "referenceImageUrls" | "referenceVideoUrls" | "characterReferences">): "keyframe" | "reference" {
  const start = args.startFrameUrl?.trim()
  const anyReference =
    cleanList(args.referenceImageUrls).length > 0 ||
    cleanList(args.referenceVideoUrls).length > 0 ||
    (args.characterReferences ?? []).some(hasCharacterImage)
  return start && !anyReference ? "keyframe" : "reference"
}

function buildFlash(args: Kling4RequestArgs): Kling4Request {
  const notes: string[] = []
  // Flash takes no end frame on either endpoint (the keyframe schema refuses
  // `last_frame`, and the editor offers none); one that arrives is dropped.
  if (args.endFrameUrl?.trim()) notes.push("dropped the end frame: Kling 4.0 Flash takes none")
  if (kling4FlashEndpoint(args) === "keyframe") return buildFlashKeyframe(args, notes)
  return buildReference({ ...args, endFrameUrl: undefined }, { flash: true, notes })
}

function buildFlashKeyframe(args: Kling4RequestArgs, notes: string[]): Kling4Request {
  const first = args.startFrameUrl!.trim()
  const audio = cleanList(args.referenceAudioUrls)
  if (audio.length > 0) {
    notes.push(`dropped ${audio.length} reference audio clip(s): Kling 4.0 Flash binds clip N to character N as its voice, and no character that can carry one (2-4 images) is connected`)
  }
  // The frame is the run's only image: a prompt naming it `@image_1` (the seat
  // it takes on the reference endpoint) means `@first_frame` here. Every other
  // mention is undeclared and loses its `@`.
  let prompt = renumber(args.prompt, "image", (n) => (n === 1 ? "first_frame" : undefined))
  prompt = neutralizeUndeclaredMentions(prompt, ["first_frame"])
  // No `aspect_ratio`: this endpoint is reached only with a frame, and the clip
  // follows the frame's shape.
  const input: Record<string, unknown> = {
    prompt,
    duration: args.durationSec,
    resolution: KLING_4_FLASH_RESOLUTION,
    first_frame_url: first,
  }
  return { model: KLING_4_FLASH_KEYFRAME_MODEL, input, notes }
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
  /** An image subject's 2-4 images; a video subject's images, read only to
   *  recognise its portrait's seat (a video subject sends no images). */
  imageUrls: string[]
  /** A video subject's clip (`characterReferences[].videoUrl`). */
  videoUrl?: string
  description?: string
}

/**
 * The reference-to-video body. `flash` builds Kling 4.0 Flash's (its own KIE
 * model, 720p whatever was asked, and no `voices`): reference audio clip N
 * belongs to wired character N, in `characterReferences` order (decided
 * 2026-11-11) — that character's `voice_url` when it is a subject (2-4
 * images, or a clip), dropped with a note when it is not (one image makes a
 * plain reference image, which cannot carry a voice) or when there is no
 * character N. `@audio_N` is left undeclared so it loses its `@`.
 *
 * VIDEO SUBJECTS (decided 2026-11-13): a character with a `videoUrl` is a
 * video subject — `{ name, video_url, tag: "character" }` (Flash adds
 * `type: "video"`; Kling 4.0's schema has no `type`), never `image_urls`
 * beside it. Its clip arrives seated among the reference videos
 * (`seatCharacterVideos`, which is how it was measured and priced): that seat
 * leaves `video_urls` and its `@video_N` names the subject. Its portrait's
 * seat among the reference images is the subject too, as for an image subject.
 */
function buildReference(args: Kling4RequestArgs, opts: { flash?: boolean; notes?: string[] } = {}): Kling4Request {
  const notes: string[] = opts.notes ?? []
  const flash = opts.flash === true
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
  /** Per wired character, in arrival order: its subject's index, or undefined when it is none. */
  const subjectOfCharacter: Array<number | undefined> = []
  for (const ref of (args.characterReferences ?? []).slice(0, MAX_SUBJECTS)) {
    const images = [...new Set(cleanList([ref.imageUrl, ref.bodyImageUrl ?? "", ...(ref.extraImageUrls ?? [])]))]
      .slice(0, MAX_SUBJECT_IMAGES)
    const videoUrl = ref.videoUrl?.trim()
    if (videoUrl) {
      subjectOfCharacter.push(subjects.length)
      subjects.push({
        name: uniqueName(kling4Name(ref.name, `Character${subjects.length + 1}`), taken),
        rawName: ref.name,
        imageUrls: images,
        videoUrl,
        description: ref.description?.trim().slice(0, SUBJECT_DESCRIPTION_MAX) || undefined,
      })
      continue
    }
    if (images.length < 2) {
      subjectOfCharacter.push(undefined)
      if (images.length === 1) singleImageRefs.push({ rawName: ref.name, url: images[0]! })
      continue
    }
    subjectOfCharacter.push(subjects.length)
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

  // A video subject's clip seat IS that subject: its `@video_N` becomes
  // `@Name` and the clip leaves the list; the other videos renumber (with no
  // video subject the numbering is unchanged).
  const subjectByVideo = new Map<string, Subject>()
  for (const s of subjects) if (s.videoUrl && !subjectByVideo.has(s.videoUrl)) subjectByVideo.set(s.videoUrl, s)
  const videos: string[] = []
  const videoSeatName = new Map<number, string>()
  cleanList(args.referenceVideoUrls).forEach((url, i) => {
    const subject = subjectByVideo.get(url)
    if (subject) {
      videoSeatName.set(i + 1, subject.name)
    } else if (videos.length < MAX_VIDEOS) {
      videos.push(url)
      videoSeatName.set(i + 1, `video_${videos.length}`)
    }
  })
  prompt = renumber(prompt, "video", (n) => videoSeatName.get(n))
  let voices: Array<{ name: string; audio_url: string }> = []
  /** Flash: subject i's voice clip, index-aligned with `subjects`. */
  const subjectVoices: Array<string | undefined> = subjects.map(() => undefined)
  if (flash) {
    // No standalone voice on Flash: clip N is wired character N's voice. A clip
    // has no `@` name of its own, so `@audio_N` stays undeclared below.
    cleanList(args.referenceAudioUrls).forEach((url, i) => {
      const subject = subjectOfCharacter[i]
      if (subject !== undefined) {
        subjectVoices[subject] = url
      } else if (i < subjectOfCharacter.length) {
        notes.push(`dropped reference audio clip ${i + 1}: character ${i + 1} has fewer than 2 images, so it cannot carry a voice`)
      } else {
        notes.push(`dropped reference audio clip ${i + 1}: no character ${i + 1} is connected to carry it`)
      }
    })
  } else {
    const audio = cleanList(args.referenceAudioUrls).slice(0, MAX_VOICES)
    voices = audio.map((url, i) => ({ name: uniqueName(`Voice${i + 1}`, taken), audio_url: url }))
    prompt = renumber(prompt, "audio", (n) => voices[n - 1]?.name)
  }

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
    resolution: flash ? KLING_4_FLASH_RESOLUTION : normalizeKling4Resolution(args.resolution),
  }
  const aspect = args.aspectRatio?.trim()
  if (aspect && KLING_4_ASPECTS.has(aspect)) input.aspect_ratio = aspect
  if (images.length > 0) input.image_urls = images
  if (videos.length > 0) {
    input.video_urls = videos
    input.keep_original_sound = args.keepOriginalSound === true
  }
  if (subjects.length > 0) {
    input.elements = subjects.map((s, i) => ({
      name: s.name,
      // A video subject sends its clip and no images (KIE refuses both on one
      // element); Flash names the kind, Kling 4.0's schema has no `type`.
      ...(s.videoUrl
        ? { video_url: s.videoUrl, ...(flash ? { type: "video" } : {}) }
        : { image_urls: s.imageUrls }),
      // Only a `character` subject may carry a voice (KIE), and a video
      // subject is always one: always this tag.
      tag: "character",
      ...(s.description ? { description: s.description } : {}),
      ...(subjectVoices[i] ? { voice_url: subjectVoices[i] } : {}),
    }))
  }
  if (voices.length > 0) input.voices = voices
  return { model: flash ? KLING_4_FLASH_REFERENCE_MODEL : KLING_4_REFERENCE_MODEL, input, notes }
}
