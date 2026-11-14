"use client"

import { ttsNamedVoiceFor, ttsNamedVoices, type GeminiTtsVoiceGroup, type TtsNamedVoice } from "@nodaro/shared/model-catalog"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT, type MessageKey } from "@/lib/i18n"

/** A group's header in every language. Typed by the group union, so a group added on a sheet without a label fails tsc. */
const VOICE_GROUP_LABEL_KEYS: Record<GeminiTtsVoiceGroup, MessageKey> = {
  "tutor": "audiocfg.voiceGroupTutor",
  "commercial-voiceover": "audiocfg.voiceGroupCommercialVoiceover",
  "instructional": "audiocfg.voiceGroupInstructional",
  "podcast": "audiocfg.voiceGroupPodcast",
  "storyteller": "audiocfg.voiceGroupStoryteller",
  "digital-assistant": "audiocfg.voiceGroupDigitalAssistant",
  "call-center": "audiocfg.voiceGroupCallCenter",
  "concierge": "audiocfg.voiceGroupConcierge",
  "tech-support": "audiocfg.voiceGroupTechSupport",
  "professional": "audiocfg.voiceGroupProfessional",
}

/** What a pick writes: the voice by its wire name, as a premade voice, named by itself. A type, so the panel's record-typed `onUpdate` takes it. */
export type TtsNamedVoicePick = {
  voiceId: string
  voiceType: "premade"
  voiceDisplayName: string
  voiceLabel: string
}

interface Props {
  /** The model the panel shows (a node with no model shows the default one). */
  readonly provider: string
  readonly voiceId: string | undefined
  /** The id of the field's visible label. */
  readonly labelledBy: string
  readonly onUpdate: (patch: TtsNamedVoicePick) => void
  /**
   * Voices cloned for this request (a dialogue's clone labels, Gemini 3.8 Flash), listed first under their
   * heading; a clone label is shown as itself. A label never shadows one of the model's voices.
   */
  readonly clones?: { readonly heading: string; readonly labels: readonly string[] }
}

/** The voices in the sheet's order, in runs of one group each (a voice with no group runs on its own, unlabelled). */
function byGroup(voices: readonly TtsNamedVoice[]): { group?: GeminiTtsVoiceGroup; voices: TtsNamedVoice[] }[] {
  const runs: { group?: GeminiTtsVoiceGroup; voices: TtsNamedVoice[] }[] = []
  for (const voice of voices) {
    const last = runs[runs.length - 1]
    if (last && last.group === voice.group) last.voices.push(voice)
    else runs.push({ group: voice.group, voices: [voice] })
  }
  return runs
}

/**
 * The voice field of a text-to-speech model that speaks only its own named
 * voices (`TtsCapabilities.voices`: Gemini), in place of the ElevenLabs voice
 * browser: a list of those voices, under their groups' headers where the sheet
 * groups them (3.8), flat where it does not (3.1 / 2.5). Voice names are the
 * provider's own and stay as they are in every language.
 *
 * It shows the voice the run sends (`ttsNamedVoiceFor`): the node's when the
 * model speaks it, else the model's default. It writes only on a pick — never
 * on mount — so a node merely selected is never rewritten; a user's model
 * switch moves a voice the new model lacks (`ttsModelSwitchPatch`).
 */
export function TtsNamedVoiceSelect({ provider, voiceId, labelledBy, onUpdate, clones }: Props) {
  const t = useT()
  const voices = ttsNamedVoices(provider)
  if (!voices) return null
  const cloneLabels = (clones?.labels ?? []).filter((l) => !voices.some((v) => v.id === l))
  const value = voiceId && cloneLabels.includes(voiceId) ? voiceId : ttsNamedVoiceFor(provider, voiceId)
  const grouped = voices.some((v) => v.group)
  const item = (v: TtsNamedVoice) => (
    <SelectItem key={v.id} value={v.id}>{v.id}</SelectItem>
  )
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        // Radix can report "" while its items change; a voice is never empty.
        if (v) onUpdate({ voiceId: v, voiceType: "premade", voiceDisplayName: v, voiceLabel: v })
      }}
    >
      <SelectTrigger aria-labelledby={labelledBy} data-testid="tts-named-voice"><SelectValue /></SelectTrigger>
      <SelectContent>
        {cloneLabels.length > 0 && (
          <SelectGroup>
            <SelectLabel>{clones!.heading}</SelectLabel>
            {/* A clone's label is the person's own name for it, shown as written. */}
            {cloneLabels.map((l) => <SelectItem key={`clone:${l}`} value={l}>{l}</SelectItem>)}
          </SelectGroup>
        )}
        {grouped
          ? byGroup(voices).map((run, i) => (
              <SelectGroup key={run.group ?? `ungrouped-${i}`}>
                {run.group && <SelectLabel>{t(VOICE_GROUP_LABEL_KEYS[run.group])}</SelectLabel>}
                {run.voices.map(item)}
              </SelectGroup>
            ))
          : voices.map(item)}
      </SelectContent>
    </Select>
  )
}
