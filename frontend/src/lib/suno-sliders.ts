/** Single source of copy for Suno's advanced mix sliders — rendered by both the
 *  config panel (audio-configs) and the on-node Mix popover. Copy verified
 *  against Suno's documented sliders. */
export interface SunoSliderMeta {
  readonly key: "styleWeight" | "weirdnessConstraint" | "audioWeight"
  readonly label: string
  readonly description: string
  readonly default: number
  readonly min: number
  readonly max: number
  readonly step: number
}

export const SUNO_SLIDER_META: readonly SunoSliderMeta[] = [
  { key: "styleWeight", label: "Style Weight", description: "How literally Suno follows your Style tags.", default: 0.5, min: 0, max: 1, step: 0.01 },
  { key: "weirdnessConstraint", label: "Weirdness", description: "How far Suno strays from genre norms.", default: 0, min: 0, max: 1, step: 0.01 },
  { key: "audioWeight", label: "Audio Weight", description: "How strongly a wired voice-persona / reference steers the song.", default: 0.5, min: 0, max: 1, step: 0.01 },
]
