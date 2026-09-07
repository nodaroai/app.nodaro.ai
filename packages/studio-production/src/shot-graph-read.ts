/**
 * PARSE, part 1 — the NARROWERS over an untrusted persisted blob: the scalar
 * readers every other parse module leans on, plus the per-shot index readers
 * (beats, transitions, resume markers, voice, recipe).
 *
 * The contract these live under: each is the exact inverse of a
 * `shot-graph-wire.ts` / `shot-graph-write.ts` writer — a field written there
 * and NOT read back here is ERASED on the next debounced save (the readVoice
 * lesson). A malformed value DEGRADES (drops to undefined) rather than throwing:
 * the blob is canvas-editable, and crashing hydration is never safe.
 */
import { roundSeconds } from "./beats"
import { readReferences } from "./connected-references"
import { liveLookId, pickerByKey } from "./look-pickers"
import {
  type RecastPlan,
  type RecastVoice,
  type RecastSettings,
  type RecastVoiceFx,
  type RecastVoiceSettings,
  DEFAULT_RECAST_SETTINGS,
} from "./recast"
import type {
  LookSelectionMap,
  ShotBeat,
  ShotCharacterFx,
  ShotPendingClip,
  ShotRecipe,
  ShotTransition,
  ShotVoice,
} from "./shot"
import { TRANSITION_DIMENSION, transitionLeverId } from "./transition"
import { readDeliverySettings } from "./voice-delivery-settings"
import { readVoiceDirections } from "./voice-direction"
import { readSubjectFields } from "@nodaro/prompts"
import { TTS_PROVIDERS, type TtsProvider } from "@nodaro/shared"

import type { StudioShotEntryV2 } from "./shot-graph-types"

/**
 * A beat's incoming transition. The levers are optional, so a partially-set
 * node (an id with no levers) round-trips as itself rather than being dropped
 * whole.
 *
 * THE ID IS REQUIRED. A transition IS its catalog pick; the levers only tune
 * one. A blob carrying levers and no id is the orphan the dialog's lever gate
 * now prevents — dropping it here clears the ones stored before that gate
 * existed, which the UI can no longer reach to clear: the levers are disabled
 * without a transition, so a stuck `{ position }` would display a value the
 * user cannot take back and would ride "Copy settings from…" into other scenes.
 *
 * Blank and whitespace-only values are dropped rather than kept: this blob is
 * editable from the Nodaro canvas, and a `"   "` id would render as a nameless
 * chip wearing the "set" accent and inject a bare `.` into the render prompt.
 */
export function readTransition(value: unknown): ShotTransition | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  const v = value as Record<string, unknown>
  const str = (k: string) => {
    const s = typeof v[k] === "string" ? (v[k] as string).trim() : ""
    return s || undefined
  }
  // A transition authored before the id switch stored the catalog LABEL under
  // `name`. Resolve it back rather than dropping the pick — the window is one
  // unmerged branch wide, but a silent drop here is a choice the user made
  // vanishing on reload. Removable once no `name` remains in the wild.
  const legacy = str("name")
  const id =
    str("id") ??
    (legacy
      ? pickerByKey(TRANSITION_DIMENSION)?.catalog.find((e) => e.label === legacy)?.id
      : undefined)
  if (!id) return undefined
  // Each lever is a row id of its own catalog scale (lib/transition); a value
  // stored under the handoff's old words ("On cut", "0.4s", "Subtle") is not a
  // row of any scale and reads as unset — the pick itself is kept.
  const lever = (field: "position" | "duration" | "intensity") =>
    transitionLeverId(field, str(field))
  return {
    id,
    ...(lever("position") ? { position: lever("position") } : {}),
    ...(lever("duration") ? { duration: lever("duration") } : {}),
    ...(lever("intensity") ? { intensity: lever("intensity") } : {}),
  }
}

/**
 * A shot's Character FX node. THE ID IS REQUIRED — an effect IS its catalog
 * pick and the levers only tune one (the transition node's rule, #407): a
 * lever-only blob is a tuning for nothing, so it drops at load rather than
 * surfacing a control with no point and no way to clear it.
 */
function readCharacterFx(value: unknown): ShotCharacterFx | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  const v = value as Record<string, unknown>
  const str = (k: string) => {
    const s = typeof v[k] === "string" ? (v[k] as string).trim() : ""
    return s || undefined
  }
  const id = str("id")
  if (!id) return undefined
  return {
    id,
    ...(str("position") ? { position: str("position") } : {}),
    ...(str("duration") ? { duration: str("duration") } : {}),
    ...(str("intensity") ? { intensity: str("intensity") } : {}),
  }
}

/**
 * Narrow a persisted `beats` blob to {@link ShotBeat}[] — id/text strings,
 * seconds a positive number, optional label string + picks string-record.
 * A malformed entry drops the WHOLE list (authoring state only — degrading to
 * "no beats" is always safe; crashing hydration never is).
 */
export function readBeats(value: unknown): ReadonlyArray<ShotBeat> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const beats: ShotBeat[] = []
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return undefined
    const b = raw as Record<string, unknown>
    if (typeof b.id !== "string" || b.id.length === 0) return undefined
    if (typeof b.text !== "string") return undefined
    if (typeof b.seconds !== "number" || !Number.isFinite(b.seconds)) return undefined
    // Windows are tenths (lib/beats). The graph is canvas-editable, so an
    // off-grid length is settled onto the grid HERE rather than leaking sums
    // the editor can't show; one that rounds to nothing is a malformed window.
    const seconds = roundSeconds(b.seconds)
    if (seconds <= 0) return undefined
    let picks: Record<string, string> | undefined
    if (b.picks !== undefined) {
      if (typeof b.picks !== "object" || b.picks === null) return undefined
      picks = {}
      for (const [k, v] of Object.entries(b.picks as Record<string, unknown>)) {
        if (typeof v !== "string") return undefined
        picks[k] = v
      }
    }
    const refs = readReferences(b.references)
    const transition = readTransition(b.transition)
    const characterFx = readCharacterFx(b.characterFx)
    const directions = readVoiceDirections(b.directions)
    beats.push({
      id: b.id,
      seconds,
      text: b.text,
      ...(refs?.length ? { references: refs } : {}),
      ...(typeof b.label === "string" && b.label ? { label: b.label } : {}),
      ...(picks && Object.keys(picks).length > 0 ? { picks } : {}),
      ...(transition ? { transition } : {}),
      ...(characterFx ? { characterFx } : {}),
      ...(directions ? { directions } : {}),
    })
  }
  return beats
}

/**
 * Narrow a persisted look blob to {@link LookSelectionMap} — string values, or
 * arrays of strings for the multi-pick dimensions. Anything else DROPS the
 * whole map: a look is a preference, and degrading to "Default" is always safe
 * where throwing during hydration never is.
 */
export function readLookMap(value: unknown): LookSelectionMap | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  const out: Record<string, string | ReadonlyArray<string>> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") {
      out[k] = liveLookId(v)
    } else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      out[k] = (v as string[]).map(liveLookId)
    } else {
      return undefined
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Narrow a persisted prompt-format marker. STRICT: only the literal `2` is a
 * marker. Anything else (a future version this build cannot honour, or a
 * corrupt value) reads as LEGACY, which is the safe direction — a legacy read
 * seeds the prompt verbatim and injects nothing, where a wrongly-trusted marker
 * would fold the same look twice.
 */
export function readPromptFormat(value: unknown): 2 | undefined {
  return value === 2 ? 2 : undefined
}

// (`subject` is narrowed by the PLATFORM's own `readSubjectFields`, the
// same reader the canvas node path uses — imported at the top of this file so a
// field added to `SubjectFields` is honoured with no edit here, and so
// studio's tolerance is exactly the canvas's. Never hand-roll a key list.)

/** Narrow an unknown node-data field to a non-empty string, else undefined. */
export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Narrow a node-data field to a number, else undefined. */
export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

/**
 * Narrow a node-data field to a non-empty `string[]` (the persisted blob is
 * untrusted), filtering out non-string / empty entries. `undefined` when the
 * value isn't an array or has no usable strings — so an absent/empty field never
 * materializes a stray key on the rehydrated result.
 */
export function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  )
  return out.length ? out : undefined
}

/** Narrow a persisted revoice target → a {@link RecastPlan}, or undefined if malformed.
 *  Reads the ordered-voices shape and UPGRADES the legacy single-voice shape. */
function readRevoiceTo(value: unknown): RecastPlan | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const r = value as Record<string, unknown>
  // New shape: { orderedVoices: [{ voiceId, voiceName, keep?, settings? }…], settings }.
  if (Array.isArray(r.orderedVoices)) {
    const orderedVoices: RecastVoice[] = []
    for (const item of r.orderedVoices) {
      if (typeof item !== "object" || item === null) continue
      const v = item as Record<string, unknown>
      const voiceId = readString(v.voiceId)
      const voiceName = readString(v.voiceName)
      if (voiceId && voiceName)
        orderedVoices.push({
          voiceId,
          voiceName,
          // Per-slot overrides: a KEEP slot (null on the wire) + tuned levers.
          ...(v.keep === true ? { keep: true } : {}),
          ...(v.settings && typeof v.settings === "object"
            ? { settings: v.settings as RecastVoiceSettings }
            : {}),
        })
    }
    return orderedVoices.length > 0
      ? { orderedVoices, settings: readRecastSettings(r.settings) }
      : undefined
  }
  // Legacy single-voice shape → a one-voice plan with default settings.
  const voiceId = readString(r.voiceId)
  const voiceName = readString(r.voiceName)
  return voiceId && voiceName
    ? { orderedVoices: [{ voiceId, voiceName }], settings: DEFAULT_RECAST_SETTINGS }
    : undefined
}

/** Narrow persisted recast settings, falling back to defaults for missing/invalid keys. */
function readRecastSettings(value: unknown): RecastSettings {
  if (typeof value !== "object" || value === null) return DEFAULT_RECAST_SETTINGS
  const r = value as Record<string, unknown>
  const model = readString(r.model)
  return {
    preserveBackground: r.preserveBackground !== false,
    separationQuality: r.separationQuality === "best" ? "best" : "fast",
    musicVolumeMode:
      r.musicVolumeMode === "normalize" || r.musicVolumeMode === "manual"
        ? r.musicVolumeMode
        : "match",
    ...(typeof r.musicVolume === "number" ? { musicVolume: r.musicVolume } : {}),
    ...(r.voiceFx && typeof r.voiceFx === "object"
      ? { voiceFx: r.voiceFx as RecastVoiceFx }
      : {}),
    ...(model ? { model } : {}),
    ...(r.removeBackgroundNoise === true ? { removeBackgroundNoise: true } : {}),
  }
}

function readPendingClip(value: unknown): ShotPendingClip | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const rec = value as Record<string, unknown>
  const jobId = readString(rec.jobId)
  const provider = readString(rec.provider)
  const startedAt = readNumber(rec.startedAt)
  if (!jobId || !provider || startedAt === undefined) return undefined
  const duration = readNumber(rec.duration)
  // Character-Voice revoice provenance — preserved so a reload mid-render still
  // revoices (revoiceTo) / keeps the voiced clip's provenance (revoicedVoice*).
  const revoiceTo = readRevoiceTo(rec.revoiceTo)
  const revoicedVoiceId = readString(rec.revoicedVoiceId)
  const revoicedVoiceName = readString(rec.revoicedVoiceName)
  // The native render riding on a voice-changer follow-up marker — the failure
  // FALLBACK (a failed recast appends this instead of losing the take). Must
  // round-trip or a reload mid-recast forfeits the fallback.
  const nativeVideoUrl = readString(rec.nativeVideoUrl)
  // The `/` direction chips of the in-flight prompt — preserved so a reload
  // mid-render still lands them on the finished clip (the in-memory per-job
  // map dies with the page; this marker is the resume context).
  const directions = readVoiceDirections(rec.directions)
  // The bound `@`-entity chips — same resume contract as the directions above.
  // Without this a render that finishes after a reload lands a clip with no
  // references, and its chips degrade to plain text (the reported bug).
  const references = readReferences(rec.references)
  // The timed SHOTS the take was submitted from — same resume contract, and a
  // field written but not read back here would be ERASED on the next save.
  const beats = readBeats(rec.beats)
  // …and the scene's GENERIC PROMPT it went out under, for the same reason.
  const scenePrompt = readString(rec.scenePrompt)
  // …and its WAY OUT — narrowed through the same reader a beat's transition
  // gets, so a canvas-edited blob is held to the catalog here too.
  const endTransition = readTransition(rec.endTransition)
  return {
    jobId,
    provider,
    prompt: typeof rec.prompt === "string" ? rec.prompt : "",
    // The in-flight negative prompt — resume context like `prompt`: a reload
    // mid-render must still land it on the finished clip.
    ...(readString(rec.negativePrompt)
      ? { negativePrompt: readString(rec.negativePrompt) }
      : {}),
    startedAt,
    ...(duration !== undefined ? { duration } : {}),
    ...(revoiceTo ? { revoiceTo } : {}),
    ...(revoicedVoiceId ? { revoicedVoiceId } : {}),
    ...(revoicedVoiceName ? { revoicedVoiceName } : {}),
    ...(nativeVideoUrl ? { nativeVideoUrl } : {}),
    ...(directions ? { directions } : {}),
    ...(beats ? { beats } : {}),
    ...(scenePrompt ? { scenePrompt } : {}),
    ...(endTransition ? { endTransition } : {}),
    ...(references ? { references } : {}),
    // The submitted levers — same resume contract, and a field written but not
    // read back here would be ERASED on the next save.
    ...(readString(rec.aspectRatio)
      ? { aspectRatio: readString(rec.aspectRatio) }
      : {}),
    ...(readString(rec.resolution)
      ? { resolution: readString(rec.resolution) }
      : {}),
    // The prompt-format marker + its ids — the resume channel, and the same
    // read-it-back-or-erase contract as everything else on this marker.
    ...(readPromptFormat(rec.promptFormat) !== undefined
      ? { promptFormat: readPromptFormat(rec.promptFormat) }
      : {}),
    ...(readLookMap(rec.look) ? { look: readLookMap(rec.look) } : {}),
    // The layer split — same narrower as `look` above (liveLookId migration).
    ...(readLookMap(rec.filmLook) ? { filmLook: readLookMap(rec.filmLook) } : {}),
    ...(readLookMap(rec.sceneLook)
      ? { sceneLook: readLookMap(rec.sceneLook) }
      : {}),
    ...(readSubjectFields(rec.subject)
      ? { subject: readSubjectFields(rec.subject) }
      : {}),
  }
}

/**
 * Narrow a shot entry's in-flight animate markers: the `pendingClips` list
 * (malformed items dropped), MIGRATING a legacy single `pendingClip` (pre-
 * concurrent-markers saves) into a one-item list. `undefined` when none survive
 * — so an idle shot never materializes a stray key. The legacy key is read
 * untyped — it is intentionally absent from {@link StudioShotEntryV2} so the
 * write side can never resurrect it. (Markers go stale after RESUME_WINDOW_MS
 * ≈ 30 min, so the legacy branch is dead weight shortly after deploy — safe to
 * drop in a later cleanup.)
 */
export function readPendingClips(
  entry: StudioShotEntryV2,
): ShotPendingClip[] | undefined {
  const raw = Array.isArray(entry.pendingClips)
    ? entry.pendingClips
    : [(entry as { pendingClip?: unknown }).pendingClip]
  const markers = raw.flatMap((p) => readPendingClip(p) ?? [])
  return markers.length ? markers : undefined
}

/** Narrow a persisted `voiceType` to one of the known voice KINDs, else undefined. */
function readVoiceType(value: unknown): ShotVoice["voiceType"] {
  return value === "premade" || value === "library" || value === "custom"
    ? value
    : undefined
}

/** Narrow a persisted `ttsProvider` to a known TTS provider id, else undefined. */
function readTtsProvider(value: unknown): TtsProvider | undefined {
  return typeof value === "string" &&
    (TTS_PROVIDERS as readonly string[]).includes(value)
    ? (value as TtsProvider)
    : undefined
}

/**
 * Narrow a persisted index `voice` blob → {@link ShotVoice}, or undefined if it
 * isn't a usable record (missing url/text). Audio has no node to re-validate
 * against, so the index entry is trusted only after this shape check.
 *
 * EVERY optional ShotVoice field must be read back here — the write side
 * spreads the whole voice, so a field this reader drops is silently ERASED on
 * the next debounced save (the store, delivery-less, overwrites the server).
 * `ttsProvider` keeps regenerates + the tag-UI gate on the voice's verified
 * model; `delivery` restores the tuned levers.
 */
export function readVoice(value: unknown): ShotVoice | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  const url = readString(v.url)
  const text = typeof v.text === "string" ? v.text : undefined
  if (!url || text === undefined) return undefined
  const ttsProvider = readTtsProvider(v.ttsProvider)
  const delivery = readDeliverySettings(v.delivery)
  return {
    url,
    text,
    voiceId: readString(v.voiceId),
    voiceType: readVoiceType(v.voiceType),
    model: readString(v.model),
    ...(ttsProvider ? { ttsProvider } : {}),
    ...(delivery ? { delivery } : {}),
  }
}

/**
 * Narrow a persisted entry `recipe` blob → {@link ShotRecipe}, or undefined when
 * no usable layer survives. Each layer requires its `prompt` (the recipe's
 * substance); the voice layer requires `text` — the url-less mirror of
 * {@link readVoice} (a recipe voice has no result url yet, by definition).
 * Corrupt fields drop PER LAYER, never the whole recipe. EVERY optional field
 * the serialize side writes is read back here (the readVoice lesson).
 */
export function readRecipe(value: unknown): ShotRecipe | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const rec = value as Record<string, unknown>

  let framing: ShotRecipe["framing"]
  if (typeof rec.framing === "object" && rec.framing !== null) {
    const f = rec.framing as Record<string, unknown>
    const prompt = readString(f.prompt)
    if (prompt !== undefined) {
      const provider = readString(f.provider)
      const negativePrompt = readString(f.negativePrompt)
      const aspectRatio = readString(f.aspectRatio)
      const resolution = readString(f.resolution)
      framing = {
        prompt,
        ...(provider ? { provider } : {}),
        ...(negativePrompt ? { negativePrompt } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(resolution ? { resolution } : {}),
        // The prompt-format marker + its ids. The serialize side spreads the
        // whole layer, so a field this reader drops is ERASED on the next save.
        ...(readPromptFormat(f.promptFormat) !== undefined
          ? { promptFormat: readPromptFormat(f.promptFormat) }
          : {}),
        ...(readLookMap(f.look) ? { look: readLookMap(f.look) } : {}),
        // …and the Subject ids beside them (R48) — narrowed by the PLATFORM's
        // own reader, exactly like a result's `subject`. Same read-it-back-or-
        // erase contract as the two lines above.
        ...(readSubjectFields(f.subject)
          ? { subject: readSubjectFields(f.subject) }
          : {}),
      }
    }
  }

  let directing: ShotRecipe["directing"]
  if (typeof rec.directing === "object" && rec.directing !== null) {
    const d = rec.directing as Record<string, unknown>
    const prompt = readString(d.prompt)
    if (prompt !== undefined) {
      const provider = readString(d.provider)
      const duration = readNumber(d.duration)
      const negativePrompt = readString(d.negativePrompt)
      const directions = readVoiceDirections(d.directions)
      directing = {
        prompt,
        ...(provider ? { provider } : {}),
        ...(duration !== undefined ? { duration } : {}),
        ...(negativePrompt ? { negativePrompt } : {}),
        ...(directions ? { directions } : {}),
        // Same read-it-back-or-erase contract as the framing layer above.
        ...(readPromptFormat(d.promptFormat) !== undefined
          ? { promptFormat: readPromptFormat(d.promptFormat) }
          : {}),
        ...(readLookMap(d.look) ? { look: readLookMap(d.look) } : {}),
      }
    }
  }

  let voice: ShotRecipe["voice"]
  if (typeof rec.voice === "object" && rec.voice !== null) {
    const v = rec.voice as Record<string, unknown>
    const text = typeof v.text === "string" ? v.text : undefined
    if (text !== undefined) {
      const ttsProvider = readTtsProvider(v.ttsProvider)
      const delivery = readDeliverySettings(v.delivery)
      voice = {
        text,
        voiceId: readString(v.voiceId),
        voiceType: readVoiceType(v.voiceType),
        model: readString(v.model),
        ...(ttsProvider ? { ttsProvider } : {}),
        ...(delivery ? { delivery } : {}),
      }
    }
  }

  return framing || directing || voice
    ? {
        ...(framing ? { framing } : {}),
        ...(directing ? { directing } : {}),
        ...(voice ? { voice } : {}),
      }
    : undefined
}
