// Admin → Nodaro Motion's settings, one section per save route, as the page
// holds them (pure): how a section's stored value becomes the page's draft,
// and how a draft becomes the body its route saves. The stored settings sets
// (settings-sets-model.ts) are built from these alone: a set's value for a
// section is that body, loading it fills the draft from it, and "changed"
// compares bodies the way the page's own Save does.
//
// The keys are the server's (NODARO_MOTION_SETTINGS_SECTIONS, backend
// ee/routes/admin-nodaro-motion.ts); `__tests__/settings-sections.test.ts`
// fails when the two lists differ, and the page's typed bindings
// (`MotionSettingsBindings`) fail to compile without every key here.

import type {
  CastSwapPrismReferenceAudioByResolution,
  CastSwapPulseAudioId,
  NodaroMotionMasking,
  NodaroMotionMotion,
  NodaroMotionNoPerson,
  NodaroMotionPreciseArtStyle,
  NodaroMotionPreciseStyleRoute,
  NodaroMotionPromptParts,
  NodaroMotionPromptWording,
  NodaroMotionSteps,
  NodaroMotionStyle,
  NodaroMotionStyleOnly,
} from "@/lib/api"
import { DEFAULT_PULSE_AUDIO } from "../trends/components/PulseAudioSelect"
import { prismReferenceAudioSaved, prismReferenceAudioTriple } from "../trends/prism-reference-audio"
import { motionToSaved, toSaved } from "./model"
import { stepsToSaved } from "./components/StepsColumn"
import { styleToSaved } from "./components/StyleChoiceSelect"
import { styleOnlyToSaved } from "./components/StyleOnlyColumn"
import { preciseArtStyleToSaved } from "./components/PreciseArtStyleColumn"
import { noPersonToSaved } from "./components/NoPersonColumn"
import { preciseStyleRouteDraftOf, preciseStyleRouteToSaved, type PreciseStyleRouteDraft } from "./components/PreciseStyleRouteColumn"
import { promptPartsToSave, promptWordingToSave } from "./components/PromptPartsTabs"

/** Every section a stored set holds, by the server's key. */
export const MOTION_SETTINGS_KEYS = [
  "prompt-wording",
  "masking",
  "motion",
  "steps",
  "style",
  "pulse-audio",
  "prism-reference-audio",
  "style-only",
  "precise-art-style",
  "no-person",
  "precise-style-route",
  "advanced",
  "prompt-parts",
] as const

export type MotionSettingsKey = (typeof MOTION_SETTINGS_KEYS)[number]

/**
 * One section as the page holds it. `stored` is the setting's value as its GET answers it (null: never saved), `D`
 * the page's draft of it, `B` the body its PUT takes.
 */
export interface MotionSettingsSectionSpec<S, D, B> {
  /** The draft the page starts from for a stored value (null: never saved, the defaults). A new object. */
  draftOf(stored: S | null): D
  /** The body Save sends for a draft (the page's own "as saved" form). */
  bodyOf(draft: D): B
  /** The stored value a body carries (what a loaded set's draft is made from). */
  storedOfBody(body: B): S
  /** What the section's save hook takes for a body. */
  saveArgOf(body: B): unknown
}

function spec<S, D, B>(s: MotionSettingsSectionSpec<S, D, B>): MotionSettingsSectionSpec<S, D, B> {
  return s
}

export const MASKING_SPEC = spec<NodaroMotionMasking, NodaroMotionMasking, { masking: NodaroMotionMasking }>({
  draftOf: (stored) => structuredClone(stored ?? {}),
  bodyOf: (draft) => ({ masking: toSaved(draft) }),
  storedOfBody: (body) => body.masking,
  saveArgOf: (body) => body.masking,
})

export const MOTION_SPEC = spec<NodaroMotionMotion, NodaroMotionMotion, { motion: NodaroMotionMotion }>({
  draftOf: (stored) => structuredClone(stored ?? {}),
  bodyOf: (draft) => ({ motion: motionToSaved(draft) }),
  storedOfBody: (body) => body.motion,
  saveArgOf: (body) => body.motion,
})

export const PULSE_AUDIO_SPEC = spec<CastSwapPulseAudioId, CastSwapPulseAudioId, { pulseAudio: CastSwapPulseAudioId }>({
  // Never saved reads as the original audio.
  draftOf: (stored) => stored ?? DEFAULT_PULSE_AUDIO,
  bodyOf: (draft) => ({ pulseAudio: draft }),
  storedOfBody: (body) => body.pulseAudio,
  saveArgOf: (body) => body.pulseAudio,
})

export const PRISM_REFERENCE_AUDIO_SPEC = spec<
  CastSwapPrismReferenceAudioByResolution,
  CastSwapPrismReferenceAudioByResolution,
  { prismReferenceAudio: CastSwapPrismReferenceAudioByResolution }
>({
  // Never saved (or a resolution left out) reads as the full mix.
  draftOf: (stored) => prismReferenceAudioTriple(stored),
  bodyOf: (draft) => ({ prismReferenceAudio: prismReferenceAudioSaved(draft) }),
  storedOfBody: (body) => body.prismReferenceAudio,
  saveArgOf: (body) => body.prismReferenceAudio,
})

export const STEPS_SPEC = spec<NodaroMotionSteps, NodaroMotionSteps, { steps: NodaroMotionSteps }>({
  draftOf: (stored) => structuredClone(stored ?? {}),
  bodyOf: (draft) => ({ steps: stepsToSaved(draft) }),
  storedOfBody: (body) => body.steps,
  saveArgOf: (body) => body.steps,
})

export const STYLE_SPEC = spec<NodaroMotionStyle, NodaroMotionStyle, { style: NodaroMotionStyle }>({
  draftOf: (stored) => ({ ...(stored ?? {}) }),
  bodyOf: (draft) => ({ style: styleToSaved(draft) }),
  storedOfBody: (body) => body.style,
  saveArgOf: (body) => body.style,
})

export const ADVANCED_SPEC = spec<boolean, boolean, { show: boolean }>({
  // Never saved reads as hidden.
  draftOf: (stored) => stored ?? false,
  bodyOf: (draft) => ({ show: draft }),
  storedOfBody: (body) => body.show,
  saveArgOf: (body) => body.show,
})

export const STYLE_ONLY_SPEC = spec<NodaroMotionStyleOnly, NodaroMotionStyleOnly, { styleOnly: NodaroMotionStyleOnly }>({
  draftOf: (stored) => structuredClone(stored ?? {}),
  bodyOf: (draft) => ({ styleOnly: styleOnlyToSaved(draft) }),
  storedOfBody: (body) => body.styleOnly,
  saveArgOf: (body) => body.styleOnly,
})

export const PRECISE_ART_STYLE_SPEC = spec<NodaroMotionPreciseArtStyle, NodaroMotionPreciseArtStyle, { preciseArtStyle: NodaroMotionPreciseArtStyle }>({
  draftOf: (stored) => structuredClone(stored ?? {}),
  bodyOf: (draft) => ({ preciseArtStyle: preciseArtStyleToSaved(draft) }),
  storedOfBody: (body) => body.preciseArtStyle,
  saveArgOf: (body) => body.preciseArtStyle,
})

export const NO_PERSON_SPEC = spec<NodaroMotionNoPerson, NodaroMotionNoPerson, { noPerson: NodaroMotionNoPerson }>({
  draftOf: (stored) => structuredClone(stored ?? {}),
  bodyOf: (draft) => ({ noPerson: noPersonToSaved(draft) }),
  storedOfBody: (body) => body.noPerson,
  saveArgOf: (body) => body.noPerson,
})

export const PRECISE_STYLE_ROUTE_SPEC = spec<NodaroMotionPreciseStyleRoute, PreciseStyleRouteDraft, { preciseStyleRoute: NodaroMotionPreciseStyleRoute }>({
  draftOf: (stored) => preciseStyleRouteDraftOf(stored),
  bodyOf: (draft) => ({ preciseStyleRoute: preciseStyleRouteToSaved(draft) }),
  storedOfBody: (body) => body.preciseStyleRoute,
  saveArgOf: (body) => body.preciseStyleRoute,
})

export const PROMPT_PARTS_SPEC = spec<NodaroMotionPromptParts, NodaroMotionPromptParts, { promptParts: NodaroMotionPromptParts }>({
  draftOf: (stored) => structuredClone(stored ?? {}),
  bodyOf: (draft) => ({ promptParts: promptPartsToSave(draft) }),
  storedOfBody: (body) => body.promptParts,
  saveArgOf: (body) => body.promptParts,
})

export const PROMPT_WORDING_SPEC = spec<NodaroMotionPromptWording, NodaroMotionPromptWording, { promptWording: NodaroMotionPromptWording }>({
  draftOf: (stored) => ({ ...(stored ?? {}) }),
  bodyOf: (draft) => ({ promptWording: promptWordingToSave(draft) }),
  storedOfBody: (body) => body.promptWording,
  saveArgOf: (body) => body.promptWording,
})

/** Every section's spec, by key (a key with none does not compile). */
export const MOTION_SETTINGS_SPECS: Readonly<Record<MotionSettingsKey, MotionSettingsSectionSpec<unknown, unknown, unknown>>> = {
  "prompt-wording": PROMPT_WORDING_SPEC,
  masking: MASKING_SPEC,
  motion: MOTION_SPEC,
  steps: STEPS_SPEC,
  style: STYLE_SPEC,
  "pulse-audio": PULSE_AUDIO_SPEC,
  "prism-reference-audio": PRISM_REFERENCE_AUDIO_SPEC,
  "style-only": STYLE_ONLY_SPEC,
  "precise-art-style": PRECISE_ART_STYLE_SPEC,
  "no-person": NO_PERSON_SPEC,
  "precise-style-route": PRECISE_STYLE_ROUTE_SPEC,
  advanced: ADVANCED_SPEC,
  "prompt-parts": PROMPT_PARTS_SPEC,
}

/**
 * One section as the page binds it: what is live, what the page holds now (both as the body Save sends), and the
 * page's own load and save of it. A stored set and a loaded draft never reach a section any other way.
 */
export interface MotionSettingsBinding {
  /** Whether the live setting has loaded (nothing of it can be compared, loaded or saved before). */
  ready: boolean
  /** The live setting as a body (never saved: its defaults), or undefined until it loads. */
  live: unknown
  /** The page's draft as a body. */
  draft: unknown
  /** A body as the page would save it once loaded (the form `live` and `draft` are in). */
  canon(body: unknown): unknown
  /** Fill the draft from a body. */
  load(body: unknown): void
  /** Fill the draft from the live setting again. */
  reset(): void
  /** Save a body through the section's own route. */
  save(body: unknown): Promise<unknown>
}

export type MotionSettingsBindings = Readonly<Record<MotionSettingsKey, MotionSettingsBinding>>
