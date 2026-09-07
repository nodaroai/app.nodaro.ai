import type { ConnectedReference, TtsProvider } from "@nodaro/shared"

import type { DirectingMode } from "../model-menu"
import type { PlanFrame, PlanMotion, PlanVoice } from "../scene-plan"
import type { PlanMusic } from "../shot"
import type { SubjectSelection } from "../subject-pickers"
import { withDirectionTokens } from "../voice-direction"

import { directionsFromAudio } from "./audio"
import type {
  FrameDocument,
  MotionDocument,
  MusicDocument,
  VoiceDocument,
} from "./schema"

/**
 * The document→plan half of Stage 5 — MAP (§6.5), split out of `import.ts`
 * pre-emptively (B14): the file sat at 747 lines, under the 800-line house
 * cap, but close enough that the program's later tasks would push it over —
 * same discipline as `import-repair-sound.ts`'s split off `import-repair.ts`.
 * `toPlanFrame` / `toPlanMotion` / `toPlanMusic` / `toPlanVoice`, plus
 * `copySubject` (the private helper only `toPlanFrame` needs), each turn one
 * already-REPAIRED document node into the store's plan shape — never
 * re-validating what repair already decided. `toLookSelection` and id-minting
 * stay in `import.ts` itself: they are read by `mapDocument` directly, not by
 * any of these four. Imported here and called exactly as before the move.
 */

/** A repaired `frame.subject` map → a fresh `SubjectSelection` — arrays
 *  copied, never the document's own (mirrors `import.ts`'s `toLookSelection`
 *  copy discipline; unlike a look map, a subject field's shape — bare id or
 *  array — already IS the plan's own shape, so no per-key multi-ness lookup is
 *  needed). */
function copySubject(
  subject: Record<string, string | string[]>,
): SubjectSelection {
  const out: Record<string, string | ReadonlyArray<string>> = {}
  for (const [field, value] of Object.entries(subject)) {
    out[field] = Array.isArray(value) ? [...value] : value
  }
  return out
}

/** The Framing stage's PLAN — where an UNRENDERED scene keeps its prompt and
 *  levers (§5). The document says `model`; `FrameSettings` says `provider`. */
export function toPlanFrame(
  frame: FrameDocument,
  references: ReadonlyArray<ConnectedReference> | undefined,
): PlanFrame | undefined {
  const plan: PlanFrame = {
    ...(frame.prompt ? { prompt: frame.prompt } : {}),
    // The bakedness of the prose travels WITH it: without the flag the Composer
    // cannot tell an imported legacy prompt (look clauses already in the words)
    // from authored intent, and would fold the scene's `look` over it a second
    // time on the first Generate. Only meaningful beside a prompt.
    ...(frame.prompt && frame.promptBaked === true
      ? { promptBaked: true as const }
      : {}),
    ...(frame.model ? { provider: frame.model } : {}),
    ...(frame.aspectRatio ? { aspectRatio: frame.aspectRatio } : {}),
    ...(frame.resolution ? { resolution: frame.resolution } : {}),
    ...(frame.count !== undefined ? { count: frame.count } : {}),
    ...(frame.negativePrompt ? { negativePrompt: frame.negativePrompt } : {}),
    ...(references?.length ? { references: [...references] } : {}),
    ...(frame.referenceImageUrls?.length
      ? { referenceImageUrls: [...frame.referenceImageUrls] }
      : {}),
    ...(frame.subject && Object.keys(frame.subject).length
      ? { subject: copySubject(frame.subject) }
      : {}),
  }
  return Object.keys(plan).length > 0 ? plan : undefined
}

/** The Directing stage's PLAN. The three reference CHANNELS are deliberately
 *  absent: they belong to the scene (`directingReference*Urls`), and
 *  `PlanMotion` omits them by construction. */
export function toPlanMotion(
  motion: MotionDocument,
  references: ReadonlyArray<ConnectedReference> | undefined,
): PlanMotion | undefined {
  // A shot-less scene's cues live beside this prose (D5), so it is placed by
  // the SAME rule as a beat's (D6) — a cue's own token wins if it is already
  // there, and only a missing one gets appended.
  const directions = directionsFromAudio(motion.audio)
  const plan: PlanMotion = {
    ...(motion.prompt || directions.length > 0
      ? { prompt: withDirectionTokens(motion.prompt ?? "", directions) }
      : {}),
    ...(motion.model ? { provider: motion.model } : {}),
    ...(motion.aspectRatio ? { aspectRatio: motion.aspectRatio } : {}),
    ...(motion.resolution ? { resolution: motion.resolution } : {}),
    ...(motion.duration !== undefined ? { duration: motion.duration } : {}),
    ...(motion.negativePrompt ? { negativePrompt: motion.negativePrompt } : {}),
    ...(motion.cameraMotionId ? { cameraMotionId: motion.cameraMotionId } : {}),
    // Repair already settled this to one the resolved model's `inputs` row
    // carries (D3) — the plan simply carries the value verbatim.
    ...(motion.input ? { input: motion.input as DirectingMode } : {}),
    ...(references?.length ? { references: [...references] } : {}),
    ...(directions.length > 0 ? { directions } : {}),
  }
  return Object.keys(plan).length > 0 ? plan : undefined
}

/**
 * A repaired {@link VoiceDocument} → the scene's plan voice (plan-import-v2
 * D4) — copied verbatim, since repair has already settled every field (the
 * same "never re-validate what repair decided" discipline as
 * {@link toPlanFrame}/{@link toPlanMotion}). `ttsProvider` narrows to the
 * platform's own type here: the document keeps it a plain string so a newer
 * provider id can still travel through PARSE, and this is the one seat where
 * it must finally commit to {@link TtsProvider}, the type `PlanVoice` (via
 * `ShotVoice`) carries. The cast is HONEST as of fix round 1 (R38-1, the
 * `motion.input as DirectingMode` precedent above): `repairVoice`'s own
 * `isTtsProvider` check has already dropped anything this cast could lie
 * about, the same way repair settles `motion.input` before `toPlanMotion`
 * casts it.
 */
export function toPlanVoice(voice: VoiceDocument): PlanVoice {
  return {
    text: voice.text,
    ...(voice.casting ? { casting: voice.casting } : {}),
    ...(voice.voiceId ? { voiceId: voice.voiceId } : {}),
    ...(voice.voiceType ? { voiceType: voice.voiceType } : {}),
    ...(voice.ttsProvider ? { ttsProvider: voice.ttsProvider as TtsProvider } : {}),
    ...(voice.model ? { model: voice.model } : {}),
    ...(voice.delivery ? { delivery: { ...voice.delivery } } : {}),
  }
}

/**
 * A repaired {@link MusicDocument} → the production's plan music
 * (plan-import-v2 D5) — copied verbatim, since repair has already settled
 * every field. `selections` is ALWAYS built (never omitted): `SoundPanel`
 * seeds its pickers straight off it, so the three fields `useMusic`'s Suno
 * call needs a real value for (`vocals`, `vocalGender`, `instruments`) fall to
 * the same defaults `DEFAULT_MUSIC_SELECTIONS` uses, rather than leaving the
 * panel to invent them a second time.
 */
export function toPlanMusic(music: MusicDocument): PlanMusic {
  return {
    prompt: music.prompt,
    ...(music.duration !== undefined ? { duration: music.duration } : {}),
    selections: {
      vocals: music.vocals ?? "instrumental",
      vocalGender: music.vocalGender ?? "any",
      instruments: music.instruments ? [...music.instruments] : [],
      ...(music.genre ? { genre: music.genre } : {}),
      ...(music.mood ? { mood: music.mood } : {}),
      ...(music.singingStyle ? { singingStyle: music.singingStyle } : {}),
      ...(music.language ? { language: music.language } : {}),
    },
  }
}
