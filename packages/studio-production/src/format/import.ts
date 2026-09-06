import type { ConnectedReference } from "@nodaro/shared"

import { roundSeconds, beatsTotalSeconds } from "../beats"
import { castMentionRuns } from "../cast-mention-runs"
import { recoverTypedMentions, type MentionCandidate } from "../prompt-mentions"
import { isEmptyPlan, type ScenePlan } from "../scene-plan"
import {
  createEmptyShot,
  type LookSelectionMap,
  type PlanMusic,
  type ProductionFilmLook,
  type ProductionFolder,
  type Shot,
  type ShotBeat,
} from "../shot"
import { withDirectionTokens } from "../voice-direction"

import { directionsFromAudio } from "./audio"
import { canonicalizeDeclaredMentions } from "./import-canonical-mentions"
import { toPlanFrame, toPlanMotion, toPlanMusic, toPlanVoice } from "./import-map"
import { bindablePassages, promptKey } from "./import-passages"
import { repairDocument } from "./import-repair"
import { buildFormatRegistry, type FormatRegistry } from "./registry"
import {
  AUDIO_KEYS,
  CAST_KEYS,
  CAST_KINDS,
  DELIVERY_KEYS,
  DOCUMENT_KEYS,
  FORMAT_ID,
  FRAME_KEYS,
  LEVER_KEYS,
  MOTION_KEYS,
  MUSIC_KEYS,
  SCENE_KEYS,
  SHOT_KEYS,
  VOICE_KEYS,
  productionDocumentSchema,
  type CastEntry,
  type LookMap,
  type MusicDocument,
  type ProductionDocument,
  type ShotDocument,
} from "./schema"
import {
  issuePath,
  warning,
  type ImportWarning,
  type ImportWarningCode,
} from "./warnings"

/**
 * ONE import pipeline — `parse → validate → repair → resolve → map` (spec §6),
 * fed by BOTH sources: a pasted / uploaded / fetched file and the LLM
 * generator's output. The validator is the single trust boundary; the generator
 * is just another source, and its 200 is no more trusted than a paste.
 *
 * Pure and synchronous: it reads a document and the user's library, and returns
 * store-shaped data. LANDING it (a new production, or an append) is the
 * caller's — see `useLandProduction`.
 */

export type { ImportWarning, ImportWarningCode } from "./warnings"
// Stage 3 lives in its own module (it is the biggest of the five) but stays part
// of the pipeline's public surface.
export { repairDocument }

export interface ImportOptions {
  /** The user's library rows — characters, locations, objects, creatures. */
  readonly candidates: ReadonlyArray<MentionCandidate>
  /** A video model's clip lengths (`videoDurationOptions(model).map(d => d.value)`),
   *  injected so the importer stays a pure function of its inputs. */
  readonly durationsFor: (model: string) => ReadonlyArray<number>
  /** The catalog view. Defaults to the memoized `buildFormatRegistry()`. */
  readonly registry?: FormatRegistry
}

/** The preview's one-line receipt ("5 scenes · 12 shots · 48s · …", §6). */
export interface ImportSummary {
  readonly scenes: number
  readonly shots: number
  readonly seconds: number
  readonly imageModels: ReadonlyArray<string>
  readonly videoModels: ReadonlyArray<string>
  readonly lookPicks: number
  readonly transitions: number
  /** Every `/` cue that will land — a shot's own, plus a shot-less scene's. */
  readonly audioCues: number
  /** Every `cast` row the document names, bound or not — the DOCUMENT's own
   *  count (Task C4). */
  readonly cast: number
  /** Distinct NAMES that found a library row — the preview's "N bound". Not
   *  `cast - unresolvedCast.length`: `cast` counts rows and `unresolvedCast`
   *  de-dupes by name, so the subtraction over-counts the moment a document
   *  asks for the same actor twice. */
  readonly castBound: number
  /** `cast` rows that bind to nothing in the library — create them and re-import. */
  readonly unresolvedCast: ReadonlyArray<CastEntry>
  /** WHO each of those {@link castBound} names bound to — the same enumeration,
   *  with the library row beside the declared name. The preview lists them so a
   *  binding can be SEEN before it lands: a library "young" answering for
   *  "Young Man in Red Jacket" was invisible until the production existed
   *  (staging, 2026-09-04), and there was no way to say "not that one". */
  readonly boundCast: ReadonlyArray<BoundCastRow>
  /** A non-blank root `brief` (plan-import-v2 D6) — trimmed, the same test
   *  `importProduction`'s own `brief` result field uses. R60 (A3/A5): the
   *  brief lands in `settings.studio.storyboard.brief` without turning the
   *  Storyboard panel on, so this is the ONLY signal the preview gives that
   *  one arrived. */
  readonly brief: boolean
  /** A root `music` (plan-import-v2 D5) that survived repair — `repairMusic`
   *  drops an unparseable node or one with no prompt, so this reads the
   *  REPAIRED document, not the document's raw claim to carry one (A5). */
  readonly music: boolean
  /** Scenes whose `voice` (plan-import-v2 D4) survived repair — `repairVoice`
   *  drops a voiceover with no words, so this too counts what will actually
   *  land (A5). */
  readonly voices: number
  /**
   * DISTINCT `@` RUNS in the document's bindable prose (B12) — the mention text
   * as WRITTEN, case-folded; not a count of people, and deliberately not a
   * receipt.
   *
   * It cannot be a count of people: where a name ends inside `@Old Library
   * Annex` is exactly what the LIBRARY decides, and this number exists for the
   * state where no library is in hand. So it counts what the prose says and
   * nothing more — two mentions of one actor in two sentences count twice, and
   * `@Old Library` and `@Old Tavern` count separately (which counting by first
   * word did not).
   *
   * It is a GATE SIGNAL: `> 0` means "this document asks the library about
   * something". The dialog used to hold its CTA on `cast > 0` alone, so a
   * prose-only plan — `@mentions` with no `cast[]` rows — could land against a
   * library that hadn't arrived, with every name unbound. Read it through
   * {@link bindsSomething}, never as a number on screen (it has no receipt in
   * `summaryLine`, by decision).
   */
  readonly mentions: number
}

/**
 * ONE declared cast NAME and the library row it bound to — the preview's
 * "Bound to your library" list, and what a RECAST at landing is addressed by
 * (`useLandProduction`'s `rebinds`, keyed off {@link candidateId}).
 */
export interface BoundCastRow {
  /** The DOCUMENT's row, exactly as it was declared (its name is the ROLE's). */
  readonly entry: CastEntry
  /** The library row RESOLVE binds — and the one the PROSE binds too, by
   *  construction: `resolveMentions` narrows the binder's pool to this
   *  candidate before it reads a word ({@link candidatesForProse}), so the
   *  preview, the chip the shot lands with and the recast key
   *  (`useLandProduction`'s `rebinds`) can never name different entities. For
   *  an `ambiguous-cast` name — two rows of the row's OWN kind share it — that
   *  is the first candidate in library order; naming the other one would
   *  describe a binding nobody is going to get. */
  readonly candidateId: string
  readonly candidateName: string
}

/**
 * Does this document need the LIBRARY before it lands? A `cast[]` row and an
 * `@mention` are two spellings of the same need, and the readiness gate and the
 * copy that explains it must cover exactly the same documents — so both the
 * dialog's `castUnchecked` and the preview's unsettled line read THIS, rather
 * than each spelling the predicate out (fix round 1, A6).
 */
export function bindsSomething(summary: ImportSummary): boolean {
  return summary.cast > 0 || summary.mentions > 0
}

export type ImportResult =
  | {
      readonly ok: true
      readonly shots: ReadonlyArray<Shot>
      readonly film?: ProductionFilmLook
      readonly folders: ReadonlyArray<ProductionFolder>
      readonly title?: string
      /** The document's root `brief` (plan-import-v2 D6), trimmed — the
       *  production's own logline, landed by `useLandProduction` (`createFrom`'s
       *  6th `serializeProduction` argument, `{ brief }`). Append ignores it
       *  (§6.6 — adding scenes doesn't rename or re-brief a production, the
       *  same rule `title` already follows). On the Describe path, the dialog
       *  falls back to what the user TYPED when this is absent. */
      readonly brief?: string
      /** The document's root `music` (plan-import-v2 D5), if it repaired to
       *  something — the production's soundtrack PLAN, landed by
       *  `useLandProduction` (12th `serializeProduction` argument on create,
       *  `setMusicPlan` on append, merged per FIELD into the editor's own draft
       *  (`mergeMusicPlan`, R64/A2) rather than skipped when the store already
       *  has one). */
      readonly music?: PlanMusic
      readonly warnings: ReadonlyArray<ImportWarning>
      readonly summary: ImportSummary
    }
  | { readonly ok: false; readonly error: string; readonly path?: string }

/**
 * Stage 1 — text (or an already-parsed object) to an object that CLAIMS to be
 * ours. A wrong `format` is refused HERE, before the schema sees it (§3): the
 * message a user needs for someone else's JSON is "this isn't a studio file",
 * not a field-level complaint about `scenes`.
 */
export function parseDocument(
  input: string | unknown,
): { doc: unknown } | { error: string; path?: string } {
  let value: unknown = input
  if (typeof input === "string") {
    try {
      value = JSON.parse(input)
    } catch {
      return { error: "That file isn't valid JSON." }
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "A production file must be a JSON object." }
  }
  if ((value as { format?: unknown }).format !== FORMAT_ID) {
    return {
      error: `Not a studio production file (expected "format": "${FORMAT_ID}").`,
      path: "format",
    }
  }
  return { doc: value }
}

/**
 * Stage 2 — the structural schema (§6.2). The ONE place a document can be
 * rejected after `parse`: no `scenes`, a shot with no prose or no length, a
 * scene carrying none of the three stages. Everything else is repaired.
 */
export function validateDocument(
  raw: unknown,
): { doc: ProductionDocument } | { error: string; path?: string } {
  const parsed = productionDocumentSchema().safeParse(raw)
  if (parsed.success) return { doc: parsed.data }
  const issue = parsed.error.issues[0]
  return { error: issue.message, path: issuePath(issue.path) }
}

/** Library rows by lower-cased name, keyed EXACTLY as `recoverTypedMentions`
 *  sees them — NOT trimmed. A row whose name carries whitespace can never bind
 *  an `@Name`, so claiming it for a cast entry would promise a chip the editor
 *  never makes. A name two rows share is the ambiguity the preview flags (§3). */
function libraryByName(
  candidates: ReadonlyArray<MentionCandidate>,
): Map<string, MentionCandidate[]> {
  const out = new Map<string, MentionCandidate[]>()
  for (const c of candidates) {
    const key = c.name.toLowerCase()
    out.set(key, [...(out.get(key) ?? []), c])
  }
  return out
}

/** The name a cast row is judged by. The DOCUMENT's side IS trimmed — whitespace
 *  around an authored name is noise — and it is the identity two rows asking for
 *  the same entity share, so §6.4's "listed ONCE" survives a duplicate. */
function castKey(entry: CastEntry): string {
  return entry.name.trim().toLowerCase()
}

/** The library rows ONE cast entry binds to — by KIND and name, not name alone:
 *  a location called "River" is not the character a cast row asks for, and
 *  binding it promised the wrong entity (and called the name ambiguous when it
 *  was not). A candidate that declares no kind still matches on the name — the
 *  older candidate sources don't know theirs, and a row that used to bind must
 *  keep binding.
 *
 *  Empty for a kind this studio does not know ({@link CAST_KINDS} — the lenient
 *  schema accepts ANY string (D13), so the vocabulary is checked HERE, and one
 *  unknown kind costs its own entry rather than the document), so the summary's
 *  list and the warnings can never disagree. */
function castMatches(
  entry: CastEntry,
  byName: Map<string, MentionCandidate[]>,
): MentionCandidate[] {
  if (!CAST_KINDS.has(entry.kind)) return []
  const named = byName.get(castKey(entry)) ?? []
  const sameKind = named.filter((c) => c.kind === entry.kind)
  return sameKind.length > 0 ? sameKind : named.filter((c) => c.kind === undefined)
}

/** The pool the PROSE binds against: a declared name's candidates are exactly
 *  the ones its cast row may bind. ONE rule decides what a name means in this
 *  document — the row does — so `boundCast`'s `candidateId`, the chip the shot
 *  lands with and the recast key `useLandProduction` addresses it by can never
 *  name different entities. (`recoverTypedMentions` is kind-blind by itself,
 *  and rightly: an `@Name` with no row behind it names whatever the library
 *  calls that, which is why an undeclared name's candidates are left exactly as
 *  they came.)
 *
 *  A row that BOUND drops its same-name rivals, and that loses no SPELLING:
 *  same lower-cased name means the same name spelling and the same
 *  `roleTokenForName` token, so every `@` the pool could bind before, the
 *  survivor still binds. A row that bound NOTHING — a `character` "River"
 *  against a library holding only the location — drops them all: the row has
 *  rejected every candidate the name has, so the mention stays prose (D4),
 *  which is what the `unresolved-cast` warning beside it already promises.
 *  Without that half the name kept its whole pool and the binder handed the
 *  prose the very entity the row refused.
 *
 *  A kind this studio does not know is not a row that can speak (D13 — the
 *  ENTRY is beyond this studio, the prose is not), so those rows narrow
 *  nothing.
 *
 *  Enumerated exactly as {@link boundCast} enumerates — the first row that
 *  BINDS wins the name, and the empty pool stands only when no row for it binds
 *  — so two rows sharing a name agree with the one the preview lists. */
function candidatesForProse(
  doc: ProductionDocument,
  candidates: ReadonlyArray<MentionCandidate>,
  byName: Map<string, MentionCandidate[]>,
): ReadonlyArray<MentionCandidate> {
  // Per declared NAME: the id its row binds, or `null` for a name no row binds.
  const chosen = new Map<string, string | null>()
  for (const entry of doc.cast ?? []) {
    if (!CAST_KINDS.has(entry.kind)) continue
    const key = castKey(entry)
    if (chosen.get(key)) continue
    chosen.set(key, castMatches(entry, byName)[0]?.id ?? null)
  }
  if (chosen.size === 0) return candidates
  return candidates.filter((c) => {
    const key = c.name.toLowerCase()
    return !chosen.has(key) || chosen.get(key) === c.id
  })
}

/** The distinct cast NAMES that bound, each with the library row it bound to —
 *  the mirror of {@link unresolvedCast}, enumerated the same way (once per name,
 *  whatever the row count) so the two halves of the preview's line come from one
 *  rule. The COUNT (`castBound`) is this list's length, never a second walk. */
function boundCast(
  doc: ProductionDocument,
  candidates: ReadonlyArray<MentionCandidate>,
): BoundCastRow[] {
  const byName = libraryByName(candidates)
  const listed = new Set<string>()
  const rows: BoundCastRow[] = []
  for (const entry of doc.cast ?? []) {
    const key = castKey(entry)
    if (listed.has(key)) continue
    const match = castMatches(entry, byName)[0]
    if (!match) continue
    listed.add(key)
    rows.push({ entry, candidateId: match.id, candidateName: match.name })
  }
  return rows
}

/** The `cast` rows that bind to nothing in the library — the preview's list, and
 *  the summary's. Derived from the DOCUMENT, never from scanning the prose, and
 *  one row per NAME however many times the document asks for it. */
export function unresolvedCast(
  doc: ProductionDocument,
  candidates: ReadonlyArray<MentionCandidate>,
): CastEntry[] {
  const byName = libraryByName(candidates)
  const listed = new Set<string>()
  return (doc.cast ?? []).filter((entry) => {
    const key = castKey(entry)
    if (listed.has(key) || castMatches(entry, byName).length > 0) return false
    listed.add(key)
    return true
  })
}

/**
 * How many distinct things the prose asks the library about (B12) — see
 * {@link ImportSummary.mentions} for what the number is and is not.
 *
 * Read with the composer's own `@`-run enumerator ({@link castMentionRuns}, the
 * one reading of `@` the editor's own scan uses) rather than with the BINDER's
 * {@link recoverTypedMentions}, which is candidate-driven and answers nothing
 * against an empty pool — zero in exactly the state this gates. Deduped on the
 * whole run, not on a prefix: which prefix is the NAME is a library question,
 * and there is no library here.
 */
function countMentions(doc: ProductionDocument): number {
  const runs = new Set<string>()
  for (const { text } of bindablePassages(doc)) {
    for (const { run } of castMentionRuns(text)) runs.add(run.toLowerCase())
  }
  return runs.size
}

/**
 * Stage 4 — RESOLVE (§6.4). Every mention in every prose field binds to a
 * library entity through the load path's OWN recovery rule
 * (`recoverTypedMentions`) — delegated, never re-derived, so the importer and
 * the editor can never disagree about what a prose string names. What it is
 * handed is narrowed first ({@link candidatesForProse}): a name the DOCUMENT
 * declares means the row's own entity everywhere, prose included.
 *
 * BOTH SPELLINGS (C6). An imported document is exactly the prose that arrives
 * token-bearing: a cast chip serializes as its `@<role-slug>` token, so an
 * exported production says `@panda-2`, not `@Panda 2`. The shared reader takes
 * both — an explicit `@`, an exact case-insensitive NAME or the role TOKEN, one
 * longest-first order across the two forms, and a token claimed WHOLE (`@panda`
 * can never bind inside `@panda-2` and hand back the wrong actor). That is a
 * property of the delegation, which is why it is pinned by tests here rather
 * than restated as a second rule.
 *
 * Unresolved names stay prose — nothing is created (D4).
 */
export function resolveMentions(
  doc: ProductionDocument,
  candidates: ReadonlyArray<MentionCandidate>,
): { bindings: Map<string, ConnectedReference[]>; warnings: ImportWarning[] } {
  const bindings = new Map<string, ConnectedReference[]>()
  const warnings: ImportWarning[] = []
  const byName = libraryByName(candidates)
  const prose = candidatesForProse(doc, candidates, byName)

  for (const { key, text } of bindablePassages(doc)) {
    const refs = recoverTypedMentions(text, [], prose)
    if (refs.length > 0) bindings.set(key, refs)
  }

  // A NAME is complained about once PER OUTCOME (§6.4): the preview lists what
  // to create, not how many rows or mentions asked for it. Per outcome, not per
  // name — one set spanning both codes lets a name that is AMBIGUOUS for one row
  // and UNPLACEABLE for the next swallow the second, and `unresolvedCast` (which
  // judges each row on its own) would then name an entity no warning explains.
  const reported = new Set<string>()
  doc.cast?.forEach((entry, i) => {
    const key = castKey(entry)
    const raise = (code: ImportWarningCode, message: string) => {
      const outcome = `${code} ${key}`
      if (reported.has(outcome)) return
      reported.add(outcome)
      warnings.push(warning(code, message, `cast[${i}]`))
    }
    if (!CAST_KINDS.has(entry.kind)) {
      raise(
        "unresolved-cast",
        `"${entry.name}" is a "${entry.kind}", which this studio doesn't have — bind the chip by hand.`,
      )
      return
    }
    const matches = castMatches(entry, byName)
    if (matches.length === 0) {
      raise(
        "unresolved-cast",
        `"${entry.name}" is not in your library — create it and re-import, or bind the chip by hand.`,
      )
      return
    }
    if (matches.length > 1) {
      raise(
        "ambiguous-cast",
        `"${entry.name}" names more than one library entity — check which one bound.`,
      )
    }
  })

  return { bindings, warnings }
}

/**
 * A look map in the shape the EDITOR writes (`V2LookPicker`): a multi-pick key
 * always holds an ARRAY, a single-pick key a bare id. Repair has already made
 * the ids and the cardinality legal; this is only the shape, read from the
 * registry so a dimension that becomes multi-pick needs no edit here.
 */
function toLookSelection(
  map: LookMap,
  registry: FormatRegistry,
): LookSelectionMap {
  const out: Record<string, string | ReadonlyArray<string>> = {}
  for (const [key, value] of Object.entries(map)) {
    const ids = Array.isArray(value) ? value : [value]
    out[key] = registry.pickers.find((p) => p.key === key)?.multi ? [...ids] : ids[0]
  }
  return out
}

/** One shot document → a `ShotBeat` with a FRESH id (D3 — ids in the file are
 *  ignored, so a file imported twice cannot collide), minted like
 *  `beatSkeleton` but WITH the prose a plan carries. */
function toBeat(
  shot: ShotDocument,
  references: ReadonlyArray<ConnectedReference> | undefined,
): ShotBeat {
  // Repair has settled every pick to one id; the document TYPE still allows an
  // array, so the narrowing stays here rather than as a cast.
  const picks = Object.fromEntries(
    Object.entries(shot.picks ?? {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  )
  // D6 — a cue's token PLACES itself: if the author already typed `[wind]`
  // inline it stays exactly there, and only a cue with no token in the prose
  // gets one appended.
  const directions = directionsFromAudio(shot.audio)
  return {
    id: crypto.randomUUID(),
    seconds: shot.seconds,
    text: withDirectionTokens(shot.text, directions),
    ...(shot.label ? { label: shot.label } : {}),
    ...(Object.keys(picks).length > 0 ? { picks } : {}),
    ...(references?.length ? { references: [...references] } : {}),
    ...(shot.transition ? { transition: { ...shot.transition } } : {}),
    ...(shot.characterFx ? { characterFx: { ...shot.characterFx } } : {}),
    ...(directions.length > 0 ? { directions } : {}),
  }
}

/**
 * Stage 5 — MAP (§6.5): a repaired document becomes the store's own shapes.
 * Every id is minted here and nowhere else (D3); folders travel as NAMES, so a
 * name the list omits creates a folder and two rows sharing one collapse.
 */
export function mapDocument(
  doc: ProductionDocument,
  bindings: ReadonlyMap<string, ReadonlyArray<ConnectedReference>>,
  registry: FormatRegistry,
): {
  shots: Shot[]
  film?: ProductionFilmLook
  folders: ProductionFolder[]
} {
  const folders: ProductionFolder[] = []
  const folderId = (name: string | undefined): string | undefined => {
    const trimmed = name?.trim()
    if (!trimmed) return undefined
    const existing = folders.find((f) => f.name === trimmed)
    if (existing) return existing.id
    const created: ProductionFolder = { id: crypto.randomUUID(), name: trimmed }
    folders.push(created)
    return created.id
  }
  // The list sets the render order; a scene may still name one it omits.
  for (const name of doc.folders ?? []) folderId(name)

  const shots = doc.scenes.map((scene, i) => {
    let shot: Shot = createEmptyShot()
    const name = scene.name?.trim()
    if (name) shot = { ...shot, name }
    const folder = folderId(scene.folder)
    if (folder) shot = { ...shot, folderId: folder }
    const look = scene.look ? toLookSelection(scene.look, registry) : undefined
    if (look && Object.keys(look).length > 0) shot = { ...shot, look }
    const beats = scene.shots?.map((s, n) =>
      toBeat(s, bindings.get(promptKey(i, `shot:${n}`))),
    )
    if (beats?.length) shot = { ...shot, beats }
    // The scene's own prose, landing on the SHOT rather than in the plan — it
    // is authoring state like `beats`, not a directing lever. TRIMMED, the way
    // export writes it and the store keeps it: a whitespace-only draft would
    // otherwise land as a field the next save silently drops.
    const scenePrompt = scene.motion?.scenePrompt?.trim()
    if (scenePrompt) shot = { ...shot, scenePrompt }
    // How the scene goes out — landing on the SHOT rather than in the plan, for
    // the reason `scenePrompt` does: it is authoring state the shot itself owns
    // (`PlanMotion` excludes `beats` and `scenePrompt` by name so a plan can
    // never keep a second copy of what the composer writes). Repair has already
    // settled it against the catalog, so it is copied verbatim.
    if (scene.motion?.endTransition) {
      shot = { ...shot, endTransition: { ...scene.motion.endTransition } }
    }
    if (scene.motion?.referenceImageUrls?.length) {
      shot = { ...shot, directingReferenceUrls: [...scene.motion.referenceImageUrls] }
    }
    if (scene.motion?.referenceVideoUrls?.length) {
      shot = {
        ...shot,
        directingReferenceVideoUrls: [...scene.motion.referenceVideoUrls],
      }
    }
    if (scene.motion?.referenceAudioUrls?.length) {
      shot = {
        ...shot,
        directingReferenceAudioUrls: [...scene.motion.referenceAudioUrls],
      }
    }
    const frame = scene.frame
      ? toPlanFrame(scene.frame, bindings.get(promptKey(i, "frame")))
      : undefined
    const motion = scene.motion
      ? toPlanMotion(scene.motion, bindings.get(promptKey(i, "motion")))
      : undefined
    const voice = scene.voice ? toPlanVoice(scene.voice) : undefined
    const plan: ScenePlan = {
      ...(frame ? { frame } : {}),
      ...(motion ? { motion } : {}),
      ...(voice ? { voice } : {}),
    }
    if (!isEmptyPlan(plan)) shot = { ...shot, plan }
    return shot
  })

  const film = doc.film ? toLookSelection(doc.film, registry) : undefined
  return {
    shots,
    ...(film && Object.keys(film).length > 0 ? { film } : {}),
    folders,
  }
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/**
 * Unknown keys at every FIXED-SHAPE level (§3: "a file written by a newer
 * studio opens in an older one, minus what it can't understand"). It runs on
 * the RAW object because the schema STRIPS what it doesn't know — by `validate`
 * the evidence is gone.
 *
 * `film` / `look` / `picks` are deliberately not swept: their keys are picker
 * keys, and repair checks them against the registry.
 */
function unknownKeyWarnings(raw: unknown): ImportWarning[] {
  const warnings: ImportWarning[] = []
  const sweep = (value: unknown, known: ReadonlySet<string>, path: string) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return
    for (const key of Object.keys(value)) {
      if (known.has(key)) continue
      warnings.push(
        warning(
          "unknown-key",
          `"${key}" is not part of this format — dropped.`,
          path ? `${path}.${key}` : key,
        ),
      )
    }
  }
  sweep(raw, DOCUMENT_KEYS, "")
  const doc = raw as { scenes?: unknown; cast?: unknown }
  asArray(doc.scenes).forEach((scene, i) => {
    const at = `scenes[${i}]`
    sweep(scene, SCENE_KEYS, at)
    const s = scene as { frame?: unknown; motion?: unknown; shots?: unknown; voice?: unknown }
    sweep(s.frame, FRAME_KEYS, `${at}.frame`)
    sweep(s.motion, MOTION_KEYS, `${at}.motion`)
    const motion = s.motion as
      | { audio?: unknown; endTransition?: unknown }
      | undefined
    // The scene's own transition node, swept like a shot's — `MOTION_KEYS`
    // above only walks `motion`'s own keys, never into the node.
    sweep(motion?.endTransition, LEVER_KEYS, `${at}.motion.endTransition`)
    asArray(motion?.audio).forEach((layer, j) =>
      sweep(layer, AUDIO_KEYS, `${at}.motion.audio[${j}]`),
    )
    asArray(s.shots).forEach((shot, n) => {
      const shotAt = `${at}.shots[${n}]`
      sweep(shot, SHOT_KEYS, shotAt)
      const node = shot as { transition?: unknown; characterFx?: unknown; audio?: unknown }
      sweep(node.transition, LEVER_KEYS, `${shotAt}.transition`)
      sweep(node.characterFx, LEVER_KEYS, `${shotAt}.characterFx`)
      asArray(node.audio).forEach((layer, j) =>
        sweep(layer, AUDIO_KEYS, `${shotAt}.audio[${j}]`),
      )
    })
    sweep(s.voice, VOICE_KEYS, `${at}.voice`)
    sweep((s.voice as { delivery?: unknown } | undefined)?.delivery, DELIVERY_KEYS, `${at}.voice.delivery`)
  })
  asArray(doc.cast).forEach((entry, i) => sweep(entry, CAST_KEYS, `cast[${i}]`))
  // The production's ONE soundtrack (plan-import-v2 D5) — the root sweep above
  // (`sweep(raw, DOCUMENT_KEYS, "")`) only walks the document's OWN top-level
  // keys, so `music` (a KNOWN key there, always) is never itself flagged by
  // it; a NESTED field of `music` (`music.tempo`, say) is a different object
  // the root sweep never reaches into, which is what this dedicated call is
  // for — the same "one call per level" discipline every fixed-shape node
  // above it gets.
  sweep((raw as { music?: unknown }).music, MUSIC_KEYS, "music")
  return warnings
}

/** The preview's receipt, counted off the REPAIRED document — what will land,
 *  not what was written. `lookPicks` counts DIMENSIONS, not ids: a multi-pick
 *  key holding two ids is one pick, the way the look panel shows it. */
function summarize(
  doc: ProductionDocument,
  candidates: ReadonlyArray<MentionCandidate>,
): ImportSummary {
  const unique = (ids: ReadonlyArray<string | undefined>) => [
    ...new Set(ids.filter((id): id is string => !!id)),
  ]
  const lookKeys = (map: LookMap | undefined) => Object.keys(map ?? {}).length
  const bound = boundCast(doc, candidates)
  return {
    scenes: doc.scenes.length,
    shots: doc.scenes.reduce((n, s) => n + (s.shots?.length ?? 0), 0),
    seconds: roundSeconds(
      doc.scenes.reduce(
        (total, s) =>
          total +
          (s.shots?.length ? beatsTotalSeconds(s.shots) : (s.motion?.duration ?? 0)),
        0,
      ),
    ),
    imageModels: unique(doc.scenes.map((s) => s.frame?.model)),
    videoModels: unique(doc.scenes.map((s) => s.motion?.model)),
    lookPicks: doc.scenes.reduce(
      (n, s) =>
        n +
        lookKeys(s.look) +
        (s.shots ?? []).reduce((m, shot) => m + lookKeys(shot.picks), 0),
      lookKeys(doc.film),
    ),
    // Every transition that will land: each shot's way IN, plus the scene's own
    // way OUT — one receipt, because they are one catalog in two seats.
    transitions: doc.scenes.reduce(
      (n, s) =>
        n +
        (s.shots ?? []).filter((shot) => !!shot.transition).length +
        (s.motion?.endTransition ? 1 : 0),
      0,
    ),
    audioCues: doc.scenes.reduce(
      (n, s) =>
        n +
        (s.motion?.audio?.length ?? 0) +
        (s.shots ?? []).reduce((m, shot) => m + (shot.audio?.length ?? 0), 0),
      0,
    ),
    cast: doc.cast?.length ?? 0,
    castBound: bound.length,
    unresolvedCast: unresolvedCast(doc, candidates),
    boundCast: bound,
    brief: !!doc.brief?.trim(),
    music: !!doc.music,
    voices: doc.scenes.filter((s) => !!s.voice).length,
    mentions: countMentions(doc),
  }
}

/**
 * The whole pipeline, for BOTH sources (§6). Pure: it lands nothing — the
 * caller decides between a new production and an append (`useLandProduction`),
 * and the preview shows `summary` + `warnings` before either happens.
 */
export function importProduction(
  input: string | unknown,
  opts: ImportOptions,
): ImportResult {
  const parsed = parseDocument(input)
  if ("error" in parsed) {
    return { ok: false, error: parsed.error, ...(parsed.path ? { path: parsed.path } : {}) }
  }
  // Swept BEFORE the schema strips them.
  const unknown = unknownKeyWarnings(parsed.doc)
  const validated = validateDocument(parsed.doc)
  if ("error" in validated) {
    return {
      ok: false,
      error: validated.error,
      ...(validated.path ? { path: validated.path } : {}),
    }
  }
  const registry = opts.registry ?? buildFormatRegistry()
  const repaired = repairDocument(validated.doc, registry, opts.durationsFor)
  // Stage 4 opens by CANONICALIZING every declared name to its role token
  // (D41): the document that resolves is the document that maps, previews and
  // lands, so no reader downstream ever sees the `@Name` spelling a shorter
  // library name could bind inside.
  const canonical = canonicalizeDeclaredMentions(repaired.doc)
  const resolved = resolveMentions(canonical, opts.candidates)
  const mapped = mapDocument(canonical, resolved.bindings, registry)
  return {
    ok: true,
    shots: mapped.shots,
    ...(mapped.film ? { film: mapped.film } : {}),
    folders: mapped.folders,
    ...(repaired.doc.title ? { title: repaired.doc.title } : {}),
    ...(repaired.doc.brief?.trim() ? { brief: repaired.doc.brief.trim() } : {}),
    // `doc.music` is `unknown` at the document's own type (fix round 2, R42 —
    // the trust boundary for this slot moved into `repairMusic`), but a value
    // surviving repair is a `MusicDocument` by construction: `repairMusic`
    // safe-parses it against the lenient shape and returns `undefined` on
    // failure or an empty prompt, so a truthy `repaired.doc.music` here has
    // already been through that gate. Honest cast, same precedent as
    // `toPlanMotion`'s own `motion.input as DirectingMode` (`import-map.ts`).
    ...(repaired.doc.music
      ? { music: toPlanMusic(repaired.doc.music as MusicDocument) }
      : {}),
    warnings: [...unknown, ...repaired.warnings, ...resolved.warnings],
    summary: summarize(canonical, opts.candidates),
  }
}
