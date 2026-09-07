import {
  lookPickerKeys,
  shotPickKeys,
  type FormatRegistry,
  type RegistryModel,
  type RegistryNode,
  type RegistryOption,
  type RegistryPicker,
  type RegistrySubjectDimension,
} from "./registry"
import { VOICE_TYPES } from "../tts-provider"
import { VOICE_DELIVERY_BOUNDS } from "../voice-delivery-settings"

/**
 * THE LEGEND — every id the format accepts, in the smallest form a model can
 * read (spec §4, §8).
 *
 * It is the bulk of the generator's system prompt and the whole of the
 * published `references/catalog.md`. Rendered from the registry, so a picker
 * added to `LOOK_PICKERS` or a model added to an allowlist appears here with no
 * edit — which is the point: an id the legend omits is an id no model will
 * ever emit, and the importer would then have to repair a file that could have
 * been right the first time.
 *
 * `terms` adds each row's short professional TERM (the picker's own `getTerm`,
 * "whip pan left" beside "Whip Pan") — the wording that actually reaches the
 * model when the pick folds, so the author can see what a choice will say. It
 * roughly doubles the legend, which is why the skill's catalog carries it and a
 * caller may not.
 */

export interface LegendOptions {
  /** Print each row's short professional term beside its label. */
  readonly terms?: boolean
  /** Include the `## Subject dimensions — frame.subject` block. It is large
   *  (every Person + Styling dimension plus the single-pick props), so
   *  `catalog.md` renders it and the generator's system prompt does not — an
   *  author reads the catalog; the generator receives only the STRUCTURAL
   *  schema (which has no `subject`) and this system prompt (which omits the
   *  block), so it cannot author `frame.subject`. The strict
   *  `schema.json` enforces that field/option vocabulary only for a
   *  hand-authored or studio-exported FILE. */
  readonly subject?: boolean
}

/** A row: `id — label`, plus the term when it says something the label doesn't. */
function optionLine(option: RegistryOption, terms: boolean): string {
  const term = terms && option.term && option.term !== option.label ? ` — ${option.term}` : ""
  return `  ${option.id} — ${option.label}${term}`
}

function pickerBlock(picker: RegistryPicker, terms: boolean): string[] {
  const cardinality = picker.multi ? `multi ≤ ${picker.maxPicks}` : "single"
  const role = picker.usableAsPick ? "usable-in-picks" : "not-usable-in-picks"
  return [
    `${picker.key} · ${picker.label} · ${cardinality} · ${role}`,
    ...picker.options.map((o) => optionLine(o, terms)),
  ]
}

function subjectDimensionBlock(dim: RegistrySubjectDimension, terms: boolean): string[] {
  const cardinality = dim.multi ? `multi ≤ ${dim.maxPicks}` : "single"
  return [
    `${dim.field} · ${dim.label} · ${dim.section} · ${cardinality}`,
    ...dim.options.map((o) => optionLine(o, terms)),
  ]
}

function nodeBlock(title: string, field: string, node: RegistryNode): string[] {
  return [
    `${title} — ${field}`,
    `  ids: ${node.ids.map((o) => o.id).join(", ")}`,
    ...node.dimensions.map((d) => `  ${d.field}: ${d.options.map((o) => o.id).join(", ")}`),
  ]
}

function modelBlock(model: RegistryModel): string[] {
  const lines = [`${model.id} — ${model.label}`]
  if (model.aspectRatios.length > 0) {
    lines.push(`  aspectRatio: ${model.aspectRatios.join(", ")}`)
  }
  if (model.resolutions.length > 0) {
    lines.push(`  resolution: ${model.resolutions.join(", ")}`)
  }
  if (model.durations.length > 0) {
    lines.push(
      `  duration: ${model.durations.join(", ")} (shots budget ${Math.max(...model.durations)}s)`,
    )
  }
  if (model.audio) {
    lines.push(`  audio: ${model.audio}`)
  }
  if (model.inputs) {
    lines.push(`  inputs: ${model.inputs.join(", ")}`)
  }
  return lines
}

export function renderLegend(
  registry: FormatRegistry,
  opts?: LegendOptions,
): string {
  const terms = opts?.terms === true
  const lookKeys = lookPickerKeys(registry)
  // The pick keys a LOOK map may NOT name — Camera Movement today. Derived, so
  // the sentence below cannot out-live the split it describes.
  const pickOnly = shotPickKeys(registry)
    .map((p) => p.key)
    .filter((key) => !lookKeys.some((p) => p.key === key))
  const lines: string[] = [
    "## Picker keys — use the ID, never the label",
    "",
    "`key · label · cardinality · role`, then that key's rows.",
    "",
    `\`film\` and \`scenes[].look\` take the ${lookKeys.length} LOOK keys — one id per key, or an`,
    "array only where that key's row says `multi ≤ N`.",
    `\`shots[].picks\` takes those PLUS the pick-only keys (${pickOnly.join(", ")}),`,
    "ALWAYS one id per key.",
    `A pick-only key is also the scene's own motion field: ${pickOnly.map((k) => `\`motion.${k}\``).join(", ")}.`,
    "A `not-usable-in-picks` key is neither a look nor a pick — its rows are the",
    "vocabulary of a lever node (`shots[].characterFx.id`).",
    "",
  ]
  for (const picker of registry.pickers) {
    lines.push(...pickerBlock(picker, terms), "")
  }
  lines.push(
    "## Layers",
    "",
    `film — only these keys: ${[...registry.filmKeys].join(", ")} (one id each)`,
    `scenes[].look — any of: ${lookPickerKeys(registry).map((p) => p.key).join(", ")}`,
    "shots[].picks — the usable-in-picks keys above, ALWAYS one id per key",
    "",
    "## Levers",
    "",
    // ONE vocabulary, two seats: a shot's own transition is how THAT shot comes
    // in, and the scene's `motion.endTransition` is how the whole clip goes out.
    // Named together rather than blocked twice — the ids and levers are the same
    // catalog, and repeating 80-odd rows would say nothing new.
    ...nodeBlock(
      "Transition (how a shot comes in; how a scene goes out)",
      "shots[].transition, scenes[].motion.endTransition",
      registry.transition,
    ),
    "",
    ...nodeBlock("Character FX (an effect on the subject)", "shots[].characterFx", registry.characterFx),
    "",
  )
  if (opts?.subject === true) {
    lines.push(
      "## Subject dimensions — frame.subject",
      "",
      "`field · label · section · cardinality`, then that field's rows. One id per field, or an",
      "array where marked `multi ≤ N`.",
      "",
    )
    for (const dim of registry.subject) lines.push(...subjectDimensionBlock(dim, terms), "")
  }
  lines.push(
    "## Audio — shots[].audio / motion.audio",
    "",
    `One cue per entry: \`{ mode, content, voice?, speaker? }\` with mode ∈ ${registry.audio.modes.join(", ")}.`,
    "`speech` is a LINE someone in the shot says (`speaker` is who says it — a name, not yet bound to `cast`; `voice` casts the delivery);",
    "`tone` is how the shot's speech is delivered; `sfx`, `ambience`, `music` are generation-ready descriptions.",
    "A cue renders only on a model whose `audio:` is `ambient` (sfx / ambience / music) or `speech` (all);",
    "`none` drops every cue with a warning at generate time. Never write bracket tokens in prose.",
    "",
    "## Image models — frame.model",
    "",
  )
  for (const model of registry.imageModels) lines.push(...modelBlock(model))
  lines.push("", "## Video models — motion.model", "")
  for (const model of registry.videoModels) lines.push(...modelBlock(model))
  lines.push(
    "",
    "## Music — music",
    "",
    `vocals: ${registry.music.vocals.join(", ")}`,
    `vocalGender: ${registry.music.vocalGenders.join(", ")}`,
    `genre: ${registry.music.genres.map((o) => o.id).join(", ")}`,
    `mood: ${registry.music.moods.map((o) => o.id).join(", ")}`,
    `instruments: ${registry.music.instruments.map((o) => o.id).join(", ")}`,
    `singingStyle: ${registry.music.singingStyles.map((o) => o.id).join(", ")}`,
    `language: ${registry.music.languages.map((o) => o.id).join(", ")}`,
    `duration: 1–${registry.music.maxDuration}s — stored on the track; never sent to the generator.`,
    "",
    "## Voice — scenes[].voice",
    "",
    "Prose: `text` (the line) and `casting` (who says it, prose — not yet bound to `cast`).",
    `A studio EXPORT additionally carries \`voiceId\` with \`voiceType\` one of \`${VOICE_TYPES.join(" | ")}\`,`,
    "`ttsProvider`, `model`, and `delivery { speed " +
      `${VOICE_DELIVERY_BOUNDS.speed.min}–${VOICE_DELIVERY_BOUNDS.speed.max}, ` +
      `stability ${VOICE_DELIVERY_BOUNDS.stability.min}–${VOICE_DELIVERY_BOUNDS.stability.max}, ` +
      `similarityBoost ${VOICE_DELIVERY_BOUNDS.similarityBoost.min}–${VOICE_DELIVERY_BOUNDS.similarityBoost.max}, ` +
      `style ${VOICE_DELIVERY_BOUNDS.style.min}–${VOICE_DELIVERY_BOUNDS.style.max} }\` — reserved, never authored by a generator.`,
    "",
    "## Defaults and limits",
    "",
    `frame.model ${registry.defaults.imageModel} · motion.model ${registry.defaults.videoModel}`,
    `aspectRatio ${registry.defaults.aspectRatio} · frame.resolution ${registry.defaults.resolution} · motion.resolution omit = Auto`,
    `shots[].seconds — step ${registry.shots.step}s; a scene with no duration lever budgets ${registry.shots.fallbackCapSeconds}s`,
    `frame.count — max ${registry.candidates.max}`,
    "",
  )
  return lines.join("\n")
}
