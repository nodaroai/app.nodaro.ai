/**
 * The voiced-video add-on (Generate Video with a character voice on an
 * `audio_driven` model): ONE reading of which dialogue lines a run will voice
 * and on which model it voices them — for the generate-video route's
 * reservation and for the worker's synthesis (workers/handlers/video-ai.ts),
 * so the add-on is priced for exactly the text and the model that run.
 *
 * The amount follows the speech seams (lib/speech-credits.ts): by length on
 * the `:per-100-chars` row of the model actually synthesised while
 * SPEECH_LENGTH_PRICING_ENABLED is on (decided 2026-10-06, Q-VOICED), the
 * flat row of the dialogue model the cast renders on while it is off — the
 * flag-off path is today's, unchanged.
 *
 * A multi-speaker cast renders on the dialogue model `voicedDialogueProvider`
 * picks from its voices (v4 when every voice shares a v4 twin, else v3). The
 * route computes it once and forwards it to the worker (`dialogueProvider`), so
 * the worker passes it back in and the plan uses it as given — never re-derived.
 */
import {
  dialogueProviderOf,
  getDialogueCapabilities,
  parseAttributedDialogue,
  resolveDialogueVoices,
  speechCredits,
  speechUnitCreditId,
  ttsSupportsAudioTags,
  type CharacterVoiceSpec,
  type DialogueLine,
  type ResolvedDialogueVoiceLine,
} from "@nodaro/shared"
import { stripAudioTags } from "../providers/elevenlabs/audio-tags.js"
import { speechLengthPricingEnabled } from "./config.js"
import { baseCreditCostFor } from "./credit-base-cost.js"
import { voicedDialogueProvider } from "./voiced-dialogue-model.js"
import { billableDialogueChars, speechRunsAs } from "./speech-credits.js"

/** The voiced fields of a generate-video body, read before Zod (the guard sees the raw body). */
export interface VoicedDialogueInput {
  prompt?: unknown
  dialogue?: unknown
  characterVoices?: unknown
  /** The dialogue model the route chose for a multi-speaker track. Absent at the reservation (derived from the voices); the worker passes the forwarded value back. */
  dialogueProvider?: unknown
}

export interface VoicedDialoguePlan {
  lines: ResolvedDialogueVoiceLine[]
  /** Lines past the dialogue total cap, not voiced (the worker logs the count). */
  dropped: number
  /** The model the track is synthesised on: the cast's dialogue model for a multi-voice cast, else the sole voice's text-to-speech model. */
  synthModel: string
  multiSpeaker: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * The well-formed `{ speaker, line }` entries of a raw `dialogue` value. The
 * route's guard reads the body BEFORE Zod (and node data can be written
 * straight into workflow JSON), so an entry that is not an object, or whose
 * fields are not strings, is skipped rather than thrown on — Zod answers 400
 * afterwards and nothing is reserved.
 */
function dialogueLinesOf(value: unknown): DialogueLine[] {
  if (!Array.isArray(value)) return []
  const out: DialogueLine[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const { speaker, line } = entry
    if (typeof speaker === "string" && typeof line === "string") out.push({ speaker, line })
  }
  return out
}

/** The usable voice specs of a raw `characterVoices` value: a string `voiceId`, the optional fields only when they are strings. */
function voiceSpecsOf(value: unknown): CharacterVoiceSpec[] {
  if (!Array.isArray(value)) return []
  const out: CharacterVoiceSpec[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.voiceId !== "string" || !entry.voiceId) continue
    out.push({
      voiceId: entry.voiceId,
      ...(typeof entry.speaker === "string" ? { speaker: entry.speaker } : {}),
      ...(typeof entry.ttsProvider === "string" ? { ttsProvider: entry.ttsProvider as CharacterVoiceSpec["ttsProvider"] } : {}),
      ...(typeof entry.voiceType === "string" ? { voiceType: entry.voiceType as CharacterVoiceSpec["voiceType"] } : {}),
    })
  }
  return out
}

/**
 * The dialogue model a cast renders on: the one the route forwarded when there
 * is one, else the one its voices pick (the route's own function, read on the
 * raw voices array so a hostile entry is "a voice with no model", never a throw).
 */
function castDialogueModel(input: VoicedDialogueInput): ReturnType<typeof dialogueProviderOf> {
  if (input.dialogueProvider !== undefined) return dialogueProviderOf(input.dialogueProvider)
  return voicedDialogueProvider(Array.isArray(input.characterVoices) ? input.characterVoices : undefined)
}

/**
 * The lines a voiced-video run will voice and the model it voices them on.
 * Lines are kept in order up to the dialogue total cap of the cast's dialogue
 * model (its capability sheet); the first line that
 * would cross it, and everything after, is dropped. More than one distinct
 * voice among the kept lines synthesises on that dialogue model in one call;
 * a single voice runs on its own text-to-speech model — the model it RUNS
 * as, so a voice that names none prices as the fallback model it is sent to.
 * Never throws for a shape: malformed entries are skipped (see above).
 */
export function planVoicedDialogue(input: VoicedDialogueInput): VoicedDialoguePlan {
  const voices = voiceSpecsOf(input.characterVoices)
  const given = dialogueLinesOf(input.dialogue)
  const lines = given.length > 0 ? given : parseAttributedDialogue(typeof input.prompt === "string" ? input.prompt : "")
  const resolved = resolveDialogueVoices(lines, voices, voices[0]?.voiceId)
  const dialogueModel = castDialogueModel(input)
  const cap = getDialogueCapabilities(dialogueModel).maxChars
  const kept: ResolvedDialogueVoiceLine[] = []
  let total = 0
  for (const l of resolved) {
    if (total + l.text.length > cap) break
    total += l.text.length
    kept.push(l)
  }
  const multiSpeaker = new Set(kept.map((l) => l.voice)).size > 1
  return {
    lines: kept,
    dropped: resolved.length - kept.length,
    synthModel: multiSpeaker ? dialogueModel : speechRunsAs(voices[0]?.ttsProvider),
    multiSpeaker,
  }
}

/** The price row the voiced add-on reserves on: the model actually synthesised (decided 2026-10-06, Q-VOICED). */
export function voicedAddonCreditId(body: VoicedDialogueInput): string {
  return planVoicedDialogue(body).synthModel
}

/**
 * The characters the planned track sends — the one count every speech seam
 * uses: a multi-voice cast is a dialogue script (the sum of its lines); a
 * single voice is the lines joined by a space and stripped of [audio tags]
 * when that model does not perform them, exactly as the worker's single-voice
 * path sends it. The join is NOT clamped to the model's cap: the worker sends
 * it whole (the plan already bounds the line sum by the dialogue cap, so the
 * join adds at most one space per line), and the add-on is priced for what is
 * sent — clamping here would bill up to a unit less than the text goes out as.
 */
function plannedSpeechChars(plan: VoicedDialoguePlan): number {
  if (plan.multiSpeaker) return billableDialogueChars(plan.lines.map((l) => ({ text: l.text, voice: l.voice })), plan.synthModel)
  const joined = plan.lines.map((l) => l.text).join(" ")
  return (ttsSupportsAudioTags(plan.synthModel) ? joined : stripAudioTags(joined)).length
}

/** BASE (pre-markup) credits of the voiced add-on: by length on the synth model's unit row while the flag is on; today's flat row of the cast's dialogue model while it is off. */
export async function voicedAddonBaseCredits(body: VoicedDialogueInput): Promise<number> {
  if (!speechLengthPricingEnabled()) return baseCreditCostFor(castDialogueModel(body))
  const plan = planVoicedDialogue(body)
  return speechCredits(plannedSpeechChars(plan), await baseCreditCostFor(speechUnitCreditId(plan.synthModel)))
}
