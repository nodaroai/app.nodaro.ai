/**
 * PARSE, part 2 — the RESULT lists and the two node readers: a canvas node's
 * `generatedResults` blob → the shot's still / clip result history, and the
 * node itself → a {@link ShotStill} / {@link ShotClip}. The exact inverses of
 * `shot-graph-wire.ts`'s result mappers and `shot-graph-write.ts`'s node
 * builders — a field written there and not read back here is ERASED on the next
 * debounced save (the readVoice lesson).
 */
import type { GenericNode } from "@nodaro/shared"

import { readReferences } from "./connected-references"
import {
  directionSpread,
  readNodeDirection,
  readNodeStructured,
  readNodeSubject,
  structuredSpread,
  subjectSpread,
} from "./shot-direction"
import type {
  ShotClip,
  ShotClipResult,
  ShotStill,
  ShotStillResult,
} from "./shot"
import { buildClip, buildStill } from "./shot"
import { readVoiceDirections } from "./voice-direction"
import { readSubjectFields } from "@nodaro/prompts"

import {
  readBeats,
  readLookMap,
  readNumber,
  readPromptFormat,
  readString,
  readStringArray,
  readTransition,
} from "./shot-graph-read"

/** Read a node's `generatedResults` blob → a ShotStillResult[] (url-bearing only). */
export function readResults(value: unknown): ShotStillResult[] {
  if (!Array.isArray(value)) return []
  const out: ShotStillResult[] = []
  for (const r of value) {
    if (typeof r !== "object" || r === null) continue
    const url = readString((r as { url?: unknown }).url)
    if (!url) continue
    const rec = r as Record<string, unknown>
    const referenceImageUrls = readStringArray(rec.referenceImageUrls)
    const references = readReferences(rec.references)
    const look = readLookMap(rec.look)
    const filmLook = readLookMap(rec.filmLook)
    const sceneLook = readLookMap(rec.sceneLook)
    const subject = readSubjectFields(rec.subject)
    out.push({
      url,
      ...(readString(rec.jobId) ? { jobId: readString(rec.jobId) } : {}),
      ...(readString(rec.name) ? { name: readString(rec.name) } : {}),
      ...(readString(rec.prompt) ? { prompt: readString(rec.prompt) } : {}),
      // The negative prompt — a field written by imageNode but not read back
      // here would be ERASED on the next save (the readVoice lesson).
      ...(readString(rec.negativePrompt)
        ? { negativePrompt: readString(rec.negativePrompt) }
        : {}),
      ...(readString(rec.provider) ? { provider: readString(rec.provider) } : {}),
      ...(referenceImageUrls ? { referenceImageUrls } : {}),
      ...(references ? { references } : {}),
      // The saved Filerobot design-state url — read back so re-editing a
      // Filerobot-edited still after a reload rebuilds its layers (still-side
      // mirror of readClipResults' freecutProjectUrl).
      ...(readString(rec.filerobotDesignStateUrl)
        ? { filerobotDesignStateUrl: readString(rec.filerobotDesignStateUrl) }
        : {}),
      // The levers this option was made with — written by stillResultToWire, so
      // NOT reading them here would erase them on the next save (the readVoice
      // lesson), and a copy would silently apply nothing.
      ...(readString(rec.aspectRatio)
        ? { aspectRatio: readString(rec.aspectRatio) }
        : {}),
      ...(readString(rec.resolution)
        ? { resolution: readString(rec.resolution) }
        : {}),
      ...(readNumber(rec.count) !== undefined ? { count: readNumber(rec.count) } : {}),
      // The prompt-format marker + its ids. STRICT on the marker: only the
      // literal `2` survives, so a corrupt value degrades to legacy (which
      // suppresses) rather than claiming a format the prompt isn't in.
      ...(readPromptFormat(rec.promptFormat) !== undefined
        ? { promptFormat: readPromptFormat(rec.promptFormat) }
        : {}),
      ...(look ? { look } : {}),
      // The layer split — through the SAME narrower as `look` above, never a
      // hand-rolled one: `readLookMap` runs every value through `liveLookId`,
      // so a retired catalog id migrates in the layers exactly as it does in
      // the merged map (INV-A3 would otherwise break the day one retires).
      ...(filmLook ? { filmLook } : {}),
      ...(sceneLook ? { sceneLook } : {}),
      ...(subject ? { subject } : {}),
    })
  }
  return out
}

/**
 * Read a generate-video node's `generatedResults` blob → a ShotClipResult[]
 * (url-bearing only; the video mirror of {@link readResults}). Each result
 * carries the source start/end frames it was generated from + prompt/jobId.
 */
export function readClipResults(value: unknown): ShotClipResult[] {
  if (!Array.isArray(value)) return []
  const out: ShotClipResult[] = []
  for (const r of value) {
    if (typeof r !== "object" || r === null) continue
    const url = readString((r as { url?: unknown }).url)
    if (!url) continue
    const rec = r as Record<string, unknown>
    const duration = readNumber(rec.duration)
    const referenceImageUrls = readStringArray(rec.referenceImageUrls)
    const referenceVideoUrls = readStringArray(rec.referenceVideoUrls)
    const referenceAudioUrls = readStringArray(rec.referenceAudioUrls)
    const references = readReferences(rec.references)
    const directions = readVoiceDirections(rec.directions)
    const beats = readBeats(rec.beats)
    const endTransition = readTransition(rec.endTransition)
    const look = readLookMap(rec.look)
    const filmLook = readLookMap(rec.filmLook)
    const sceneLook = readLookMap(rec.sceneLook)
    const subject = readSubjectFields(rec.subject)
    out.push({
      url,
      ...(readString(rec.jobId) ? { jobId: readString(rec.jobId) } : {}),
      // The take name — a field written by clipResultToWire but not read back
      // here would be ERASED on the next save (the readVoice lesson).
      ...(readString(rec.name) ? { name: readString(rec.name) } : {}),
      ...(readString(rec.prompt) ? { prompt: readString(rec.prompt) } : {}),
      // The negative prompt — same read-it-back-or-erase contract.
      ...(readString(rec.negativePrompt)
        ? { negativePrompt: readString(rec.negativePrompt) }
        : {}),
      ...(readString(rec.provider) ? { provider: readString(rec.provider) } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(readString(rec.startFrameUrl)
        ? { startFrameUrl: readString(rec.startFrameUrl) }
        : {}),
      ...(readString(rec.endFrameUrl)
        ? { endFrameUrl: readString(rec.endFrameUrl) }
        : {}),
      ...(referenceImageUrls ? { referenceImageUrls } : {}),
      ...(referenceVideoUrls ? { referenceVideoUrls } : {}),
      ...(referenceAudioUrls ? { referenceAudioUrls } : {}),
      ...(references ? { references } : {}),
      ...(directions ? { directions } : {}),
      ...(beats ? { beats } : {}),
      // The scene's GENERIC PROMPT the take was made under — written by
      // clipResultToWire, so it must be read back here or the next save erases it.
      ...(readString(rec.scenePrompt)
        ? { scenePrompt: readString(rec.scenePrompt) }
        : {}),
      // …and the WAY OUT it was folded with, same contract, same narrower as a
      // beat's own transition.
      ...(endTransition ? { endTransition } : {}),
      ...(readString(rec.freecutProjectUrl)
        ? { freecutProjectUrl: readString(rec.freecutProjectUrl) }
        : {}),
      // Written by clipResultToWire ⇒ must be read back or the next save erases
      // them.
      ...(readString(rec.aspectRatio)
        ? { aspectRatio: readString(rec.aspectRatio) }
        : {}),
      ...(readString(rec.resolution)
        ? { resolution: readString(rec.resolution) }
        : {}),
      // The prompt-format marker + its ids. STRICT on the marker: only the
      // literal `2` survives, so a corrupt value degrades to legacy (which
      // suppresses) rather than claiming a format the prompt isn't in.
      ...(readPromptFormat(rec.promptFormat) !== undefined
        ? { promptFormat: readPromptFormat(rec.promptFormat) }
        : {}),
      ...(look ? { look } : {}),
      // The layer split — same narrower as `look` above (liveLookId migration).
      ...(filmLook ? { filmLook } : {}),
      ...(sceneLook ? { sceneLook } : {}),
      ...(subject ? { subject } : {}),
    })
  }
  return out
}

/**
 * Build a ShotStill from a generate-image node. Reconstructs the results list
 * (Nodaro `generatedResults` + `activeResultIndex`) → active `url`. A single
 * result collapses to the minimal legacy shape (no `results`/`activeIndex`) so
 * single-still productions round-trip byte-identical; >1 keeps the list.
 */
export function stillFromNode(node: GenericNode | undefined): ShotStill | undefined {
  if (!node) return undefined
  const flatUrl = readString(node.data?.generatedImageUrl)
  const results = readResults(node.data?.generatedResults)
  const rawIndex = readNumber(node.data?.activeResultIndex) ?? 0
  const activeIndex = Math.min(Math.max(0, rawIndex), Math.max(0, results.length - 1))
  // Active url: the active result, else the flat legacy field, else the first result.
  const url = results[activeIndex]?.url ?? flatUrl ?? results[0]?.url
  if (!url) return undefined
  // buildStill collapses a lone result to the minimal shape and keeps the
  // results/activeIndex list for >1 OR a lone result carrying chips (so the bound
  // `@`-entity references survive a reload). Mirrors clipFromNode -> buildClip.
  return buildStill(
    {
      nodeId: node.id,
      provider: readString(node.data?.provider),
      prompt: readString(node.data?.prompt),
      // The cinematic channel, read back through the PLATFORM's own readers so
      // studio's bounds are exactly the canvas's (see `shot-direction`).
      // Written by `imageNode` — a write without this read would be ERASED on
      // the next debounced save (the readVoice lesson).
      ...directionSpread(readNodeDirection(node.data?.direction)),
      ...subjectSpread(readNodeSubject(node.data?.subject)),
      ...structuredSpread(readNodeStructured(node.data?.structured)),
    },
    results.length > 0 ? results : [{ url }],
    results.length > 0 ? activeIndex : 0,
  )
}

/**
 * Build a ShotClip from a generate-video node, or undefined if it has no url.
 * Reconstructs the clip results list (Nodaro `generatedResults` +
 * `activeResultIndex`) → active `url`, mirroring {@link stillFromNode}. A single
 * result collapses to the minimal legacy shape (no `results`/`activeIndex`) so
 * single-clip productions round-trip byte-identical; >1 keeps the list. Re-voice
 * provenance only materializes when present (a plain clip stays bare).
 */
export function clipFromNode(node: GenericNode | undefined): ShotClip | undefined {
  if (!node) return undefined
  const flatUrl = readString(node.data?.generatedVideoUrl)
  const results = readClipResults(node.data?.generatedResults)
  const rawIndex = readNumber(node.data?.activeResultIndex) ?? 0
  const activeIndex = Math.min(Math.max(0, rawIndex), Math.max(0, results.length - 1))
  // Active url: the active result, else the flat legacy field, else the first result.
  const url = results[activeIndex]?.url ?? flatUrl ?? results[0]?.url
  if (!url) return undefined
  const revoicedVoiceId = readString(node.data?.revoicedVoiceId)
  const revoicedVoiceName = readString(node.data?.revoicedVoiceName)
  // buildClip collapses a lone result to the minimal shape (and carries the
  // duration + re-voice provenance) and keeps the results/activeIndex list for >1.
  return buildClip(
    {
      nodeId: node.id,
      provider: readString(node.data?.provider),
      prompt: readString(node.data?.prompt),
      duration: readNumber(node.data?.duration),
      ...(revoicedVoiceId ? { revoicedVoiceId } : {}),
      ...(revoicedVoiceName ? { revoicedVoiceName } : {}),
      // The cinematic channel `videoNode` writes — see `stillFromNode`.
      ...directionSpread(readNodeDirection(node.data?.direction)),
      ...subjectSpread(readNodeSubject(node.data?.subject)),
      ...structuredSpread(readNodeStructured(node.data?.structured)),
    },
    results.length > 0 ? results : [{ url }],
    results.length > 0 ? activeIndex : 0,
  )
}
