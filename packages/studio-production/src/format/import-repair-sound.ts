import { videoModelSupportsAudio } from "@nodaro/shared"

import { matchEffectTokens } from "../character-fx"
import { isTtsProvider, isVoiceType } from "../tts-provider"
import {
  DIRECTION_BRACKET_RUN,
  neutralDirectionText,
  placeTokens,
  voiceDirectionKindsFor,
} from "../voice-direction"
import {
  VOICE_DELIVERY_BOUNDS,
  VOICE_DELIVERY_DEFAULTS,
  VOICE_DELIVERY_LEVERS,
  readDeliverySettings,
} from "../voice-delivery-settings"

import { isAudioMode, directionsFromAudio } from "./audio"
import type { FormatRegistry, RegistryOption } from "./registry"
import {
  musicDocument,
  type AudioLayer,
  type MusicDocument,
  type VoiceDocument,
} from "./schema"
import { issuePath, warning, type ImportWarning } from "./warnings"

/**
 * Stage 3's SOUND repairs (plan-import-v2 D4/D5, fix round 2 R40-1) — split
 * out of `import-repair.ts` once that file crossed the 800-line house cap.
 * Same discipline as the rest of stage 3: catalog-aware, never rejecting,
 * PURE (never mutates its input; every warning is pushed onto the caller's
 * array).
 *
 * `repairAudio` (a shot's or a shot-less scene's `/` cues) and
 * `warnOrphanRuns` (the bracket-token receipt over a shot's — or a scene's
 * own — finished prose) are called from `import-repair.ts`'s
 * `repairMotion`/`repairShots` — audio repair happens ON THE WAY to a shot, so
 * it stays split from `repairVoice` (a scene's OWN voiceover plan, D4) and
 * `repairMusic` (the production's ONE soundtrack, D5), which are each called
 * once — per scene, once per document — from `repairDocument` directly. All
 * keep their warning codes, messages and paths byte-identical to before any
 * move — every relocation in this file is a pure move.
 */

/**
 * One shot's or shot-less scene's audio cues, repaired (D3): a mode outside
 * this format's vocabulary drops its cue like an unknown catalog id
 * (`unknown-id` — `repairLever` and `repairLookMap`'s own code for it), and an
 * empty one drops too, quietly — `content` is user prose, not a catalog pick,
 * so it earns its own `audio` code rather than borrowing `unknown-id`'s.
 * `voice` / `speaker` survive only on a `speech` cue — `directionsFromAudio`'s
 * rule, kept here too so a repaired document never carries a speech field a
 * SILENT cue would just ignore.
 *
 * A surviving cue is then checked against `model` — the video model the scene
 * will actually render on (A7). A cue that model cannot carry is KEPT and only
 * warned about: `renderVoiceDirection` still owns the drop at generate time,
 * so pointing the scene at a model that speaks is a model change rather than a
 * re-import. The predicate is {@link voiceDirectionKindsFor} — that renderer's
 * OWN capability gate — so the receipt can never disagree with the toast, and
 * `tone` is flagged on an ambient model alongside `speech` (both need a voice).
 */
export function repairAudio(
  layers: ReadonlyArray<AudioLayer>,
  model: string,
  path: string,
  warnings: ImportWarning[],
): AudioLayer[] | undefined {
  const carried = new Set<string>(voiceDirectionKindsFor(model))
  const kept: AudioLayer[] = []
  layers.forEach((layer, i) => {
    const at = `${path}.audio[${i}]`
    if (!isAudioMode(layer.mode)) {
      warnings.push(
        warning("unknown-id", `"${String(layer.mode)}" is not an audio mode — dropped.`, `${at}.mode`),
      )
      return
    }
    const content = layer.content.trim()
    if (!content) {
      warnings.push(warning("audio", `An empty ${layer.mode} cue was dropped.`, `${at}.content`))
      return
    }
    if (!carried.has(layer.mode)) {
      // Two sentences, the toast's own two: a model that carries SOME audio
      // just has no voice to direct; a silent one has no track at all.
      warnings.push(
        warning(
          "audio",
          videoModelSupportsAudio(model)
            ? `${model} can't take speech direction — this ${layer.mode} cue was kept, but generating will drop it.`
            : `${model} generates silent video — this ${layer.mode} cue was kept, but generating will drop it.`,
          at,
        ),
      )
    }
    const speech = layer.mode === "speech"
    const voice = speech ? layer.voice?.trim() : undefined
    const speaker = speech ? layer.speaker?.trim() : undefined
    kept.push({
      mode: layer.mode,
      content,
      ...(voice ? { voice } : {}),
      ...(speaker ? { speaker } : {}),
    })
  })
  return kept.length > 0 ? kept : undefined
}

/**
 * A bracketed run in a shot's — or a shot-less scene's — prose that no cue's
 * own token claims (B3) — rule 12 says never to write one, so it is a stage
 * direction the model will read out verbatim (the importer appends the real
 * cue's token beside it). The cues are placed FIRST, by the importer's own
 * rule ({@link placeTokens}), so a `[…]` NESTED inside a claimed token is not
 * an orphan; `[fx:<id>]` effect tokens are the other legal bracket in this
 * prose and are claimed the same way. The text itself is never touched — this
 * is a receipt, not a repair. Scans against {@link DIRECTION_BRACKET_RUN} —
 * `neutralDirectionText`'s own grammar, `voice-direction.ts`'s ONE source
 * (B2) — rather than a second hand-typed copy.
 *
 * `path` is the FULL warning path to the scanned field — `scenes[i].shots[n].
 * text` for a shot, `scenes[i].motion.prompt` / `.scenePrompt` for a
 * shot-less scene's own prose — never a parent the function itself extends
 * (a caller-owned suffix would silently disagree with every other warning's
 * path convention in this format).
 */
export function warnOrphanRuns(
  text: string,
  audio: ReadonlyArray<AudioLayer> | undefined,
  path: string,
  warnings: ImportWarning[],
): void {
  if (!text.includes("[")) return
  const tokens = directionsFromAudio(audio).map(neutralDirectionText)
  const claimed = placeTokens(text, tokens).flatMap((start, i) =>
    start === -1 ? [] : [{ start, end: start + tokens[i].length }],
  )
  for (const fx of matchEffectTokens(text)) claimed.push({ start: fx.start, end: fx.end })
  const seen = new Set<string>()
  for (const run of text.matchAll(DIRECTION_BRACKET_RUN)) {
    const start = run.index
    const end = start + run[0].length
    if (claimed.some((c) => start < c.end && end > c.start)) continue
    if (seen.has(run[0])) continue
    seen.add(run[0])
    warnings.push(
      warning(
        "audio",
        `"${run[0]}" in the prose matches no cue — it reaches the model as text.`,
        path,
      ),
    )
  }
}

/**
 * A scene's voiceover plan (plan-import-v2 D4). `text` is the only field this
 * studio's own generator ever authors (the structural schema exposes only
 * `text`/`casting` — skill rule 15); `voiceId`/`voiceType`/`ttsProvider`/
 * `model`/`delivery` are what a STUDIO EXPORT additionally writes, and repair
 * settles them the same way any other studio-authored field is settled.
 *
 * `undefined` when the voiceover has no words to say — the whole plan is
 * useless without a line, so it is dropped WITH a receipt (`"voice"`) rather
 * than kept half-formed, mirroring `repairShots`'s "drop the shot, not the
 * scene" discipline.
 */
export function repairVoice(
  voice: VoiceDocument,
  path: string,
  warnings: ImportWarning[],
): VoiceDocument | undefined {
  const text = voice.text.trim()
  if (!text) {
    warnings.push(
      warning("voice", "A voiceover with no words was dropped.", `${path}.voice.text`),
    )
    return undefined
  }
  const next: VoiceDocument = { ...voice, text }
  // Trimmed the same way `text` is above (R40-2, fix round 2) — a
  // whitespace-only casting note is no note at all, and repair must agree
  // with `scene-plan.ts`'s `readVoice`, which trims both fields already.
  if (voice.casting !== undefined) {
    const casting = voice.casting.trim()
    if (casting) next.casting = casting
    else delete next.casting
  }
  // Narrowed through the ONE guard every reader of an untrusted `voiceType`
  // uses (`isVoiceType`, `tts-provider.ts`), the twin of `isTtsProvider` below.
  if (voice.voiceType !== undefined && !isVoiceType(voice.voiceType)) {
    warnings.push(
      warning(
        "option",
        `"${voice.voiceType}" is not a voice type — dropped.`,
        `${path}.voice.voiceType`,
      ),
    )
    delete next.voiceType
  }
  // Narrowed through the ONE guard every reader of an untrusted `ttsProvider`
  // uses (`isTtsProvider`, `tts-provider.ts`, R38-1) — the same discipline
  // `voiceType` gets above, so an id valid nowhere on the platform can never
  // reach a `text-to-speech` call after this document imports.
  if (voice.ttsProvider !== undefined && !isTtsProvider(voice.ttsProvider)) {
    warnings.push(
      warning(
        "option",
        `"${voice.ttsProvider}" is not a TTS provider — dropped.`,
        `${path}.voice.ttsProvider`,
      ),
    )
    delete next.ttsProvider
  }
  // `readDeliverySettings` both narrows AND clamps against the hoisted bounds
  // (`voice-delivery-settings.ts`'s `VOICE_DELIVERY_BOUNDS`) — repair never
  // writes a second clamp. It DOES write the receipt: a clamp that changes a
  // value the author wrote is a repair like any other in this file, and the
  // preview must be able to say so ("D11 — nothing is changed without a
  // warning"). Compared per lever, against the returned object, so the one
  // clamp stays in one place. A lever pruned for sitting at its DEFAULT is not
  // a change the author needs told about — `pruneDeliverySettings` drops it,
  // and only a value that MOVED gets a receipt.
  const delivery = voice.delivery ? readDeliverySettings(voice.delivery) : undefined
  const authored = voice.delivery
  if (authored) {
    for (const lever of VOICE_DELIVERY_LEVERS) {
      const before = authored[lever]
      if (before === undefined) continue
      const after = delivery?.[lever] ?? VOICE_DELIVERY_DEFAULTS[lever]
      if (after === before) continue
      warnings.push(
        warning(
          "option",
          `${lever} ${before} is outside ${VOICE_DELIVERY_BOUNDS[lever].min}–${VOICE_DELIVERY_BOUNDS[lever].max} — clamped to ${after}.`,
          `${path}.voice.delivery.${lever}`,
        ),
      )
    }
  }
  if (delivery) next.delivery = delivery
  else delete next.delivery
  return next
}

/** A `music.<field>` catalog value not in `options` costs that FIELD, with an
 *  `unknown-id` receipt — the same "drop the field, not the document"
 *  discipline every other catalog-shaped repair in this file uses. */
function dropUnknownMusicOption(
  next: MusicDocument,
  field: "genre" | "mood" | "singingStyle" | "language",
  options: ReadonlyArray<RegistryOption>,
  warnings: ImportWarning[],
): void {
  const value = next[field]
  if (value === undefined || options.some((o) => o.id === value)) return
  warnings.push(
    warning("unknown-id", `"${value}" is not a ${field} — dropped.`, `music.${field}`),
  )
  delete next[field]
}

/**
 * The production's ONE soundtrack, repaired (plan-import-v2 D5, fix round 2
 * R42): `music` reaches here as `unknown` — the structural schema (`schema.ts`)
 * keeps the root slot unnarrowed, so a malformed soundtrack (`music: null`,
 * a string, `{}`, a wrong-typed field) costs only ITS OWN node, never the
 * whole import the way a hard structural
 * failure would. This function is therefore the trust boundary for `music`:
 * it `.safeParse`s the value against the lenient {@link musicDocument} shape
 * ONE level below the schema's own — same discipline as every other
 * catalog-shaped repair in this module, just moved down one rung because this
 * slot's shape itself isn't guaranteed yet.
 *
 * A failed parse drops the node with exactly ONE `audio` warning, at
 * `music` (nothing usable to point at — `music: null`/a string/an array) or
 * `music.<field>` when the first zod issue names one (a `{ instruments: "x" }`
 * shape mismatch, say) — the message is the same either way, so an author
 * gets "your soundtrack didn't parse" rather than a raw zod complaint.
 *
 * On a successful parse: `duration` is clamped to the format's own ceiling
 * (`registry.music.maxDuration`) rather than rejected, `vocals` /
 * `vocalGender` are checked against the registry's fixed vocabulary (the
 * `voiceType`/`ttsProvider` pattern above), and each of the five catalog
 * fields is checked against its own `registry.music.*` list — an unknown one
 * costs that field, not the soundtrack. `instruments` is filtered the same
 * way, entry by entry. An absent/blank `prompt` — the ONE required field on
 * {@link MusicDocument}'s real, strict-side shape — is treated exactly like a
 * whitespace-only one: dropped, with its own `audio` warning at
 * `music.prompt` (mirrors {@link repairVoice}'s own empty-text rule), never
 * folded into the parse-failure branch above.
 */
export function repairMusic(
  music: unknown,
  registry: FormatRegistry,
  warnings: ImportWarning[],
): MusicDocument | undefined {
  const parsed = musicDocument.safeParse(music)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    // `music.instruments[0]`, not `music.instruments.0` — the ONE path spelling
    // every other warning in this format uses (`issuePath`, warnings.ts).
    const path = issue?.path.length ? `music.${issuePath(issue.path)}` : "music"
    warnings.push(
      warning("audio", "The soundtrack could not be read and was dropped.", path),
    )
    return undefined
  }
  const prompt = (parsed.data.prompt ?? "").trim()
  if (!prompt) {
    warnings.push(
      warning("audio", "A soundtrack with no description was dropped.", "music.prompt"),
    )
    return undefined
  }
  const next: MusicDocument = { ...parsed.data, prompt }

  if (next.duration !== undefined) {
    const clamped = Math.min(Math.max(next.duration, 1), registry.music.maxDuration)
    if (clamped !== next.duration) {
      warnings.push(
        warning(
          "duration",
          `The soundtrack's duration was clamped to ${clamped}s (max ${registry.music.maxDuration}s).`,
          "music.duration",
        ),
      )
    }
    next.duration = clamped
  }

  if (next.vocals !== undefined && !registry.music.vocals.includes(next.vocals)) {
    warnings.push(
      warning("option", `"${next.vocals}" is not a vocals option — dropped.`, "music.vocals"),
    )
    delete next.vocals
  }
  if (
    next.vocalGender !== undefined &&
    !registry.music.vocalGenders.includes(next.vocalGender)
  ) {
    warnings.push(
      warning("option", `"${next.vocalGender}" is not a vocal gender — dropped.`, "music.vocalGender"),
    )
    delete next.vocalGender
  }

  dropUnknownMusicOption(next, "genre", registry.music.genres, warnings)
  dropUnknownMusicOption(next, "mood", registry.music.moods, warnings)
  dropUnknownMusicOption(next, "singingStyle", registry.music.singingStyles, warnings)
  dropUnknownMusicOption(next, "language", registry.music.languages, warnings)

  if (next.instruments) {
    // The CAP runs FIRST (fix wave): it is the contract the structural schema
    // publishes as `maxItems` — how many ids this document may ASK for — so it
    // has to bind the authored list, not the survivors. Behind the unknown-id
    // filter it could never fire (the filter leaves at most one entry per
    // catalog row), which made the published cap unenforced and untestable.
    // R66/B15, on the record: yes, this can truncate to a run of unknowns when
    // the first `maxItems` entries are all invalid ids — deliberate, not a
    // gap. A document naming more instruments than `maxItems` allows is
    // already structurally invalid regardless of which entries are unknown,
    // so which of ITS entries get kept is not this repair's problem to solve.
    const capped = next.instruments.slice(0, registry.music.instruments.length)
    // Unknown ids drop with a receipt — ONCE PER DISTINCT ID, never once per
    // repeat (the same rule the dedupe below implies); a repeated KNOWN id is
    // not unknown, so dedupe earns no warning of its own — it is silent the
    // way stripping whitespace is. ORDER preserved (first occurrence wins), so
    // an authored `[a, b, a]` reads as `[a, b]`, not `[b, a]`.
    const seenUnknown = new Set<string>()
    const filtered = capped.filter((id) => {
      const known = registry.music.instruments.some((o) => o.id === id)
      if (!known && !seenUnknown.has(id)) {
        seenUnknown.add(id)
        warnings.push(
          warning("unknown-id", `"${id}" is not an instrument — dropped.`, "music.instruments"),
        )
      }
      return known
    })
    // Dedupe (fix round 2, item 4): a doc with `["piano", "piano", …×5000]`
    // must not carry every repeat through — belt over the cap above, which
    // already bounds the list, for a catalog that ever grew duplicate ids.
    const deduped = [...new Set(filtered)]
    if (deduped.length > 0) next.instruments = deduped
    else delete next.instruments
  }

  return next
}
