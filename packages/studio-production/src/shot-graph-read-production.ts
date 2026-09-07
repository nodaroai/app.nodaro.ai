/**
 * PARSE, part 3 — the PRODUCTION-LEVEL readers over `settings.studio`: the
 * soundtrack and its plan, the cuts, the folders, the storyboard state and the
 * recycle bin, plus the two index predicates the hydrate leans on
 * ({@link isStudioIndex} / {@link studioIndexExpectsShots}).
 *
 * Same contract as the other parse modules: each is the exact inverse of a
 * `shot-graph-write.ts` writer — a field written there and not read back here is
 * ERASED on the next debounced save (the readVoice lesson) — and a malformed
 * value DEGRADES rather than throwing.
 */
import type { WorkflowLike as Workflow } from "./workflow-like"

import {
  MUSIC_VOCALS,
  MUSIC_VOCAL_GENDERS,
  hasMusicPicks,
  type MusicSelections,
} from "./music-options"
import {
  directionSpread,
  readNodeDirection,
  readNodeStructured,
  readNodeSubject,
  structuredSpread,
  subjectSpread,
} from "./shot-direction"
import type {
  PlanMusic,
  ProductionCut,
  ProductionFolder,
  ProductionMusic,
} from "./shot"
import type { TrashedItem } from "./trash"

import { readNumber, readString, readStringArray } from "./shot-graph-read"
import { readClipResults, readResults } from "./shot-graph-read-results"
import type {
  SerializedProduction,
  StoryboardSettings,
  StudioSettingsV3,
} from "./shot-graph-types"

/** Narrow a persisted `music` blob → {@link ProductionMusic}, or undefined. */
export function readMusic(value: unknown): ProductionMusic | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const m = value as Record<string, unknown>
  const url = readString(m.url)
  if (!url) return undefined
  return {
    url,
    prompt: typeof m.prompt === "string" ? m.prompt : "",
    duration: readNumber(m.duration),
    provider: readString(m.provider),
  }
}

/**
 * Narrow a persisted `musicPlan.selections` blob → {@link MusicSelections}
 * (plan-import-v2 D5), or `undefined` when `vocals`/`vocalGender` — the two
 * REQUIRED fields of the type — don't narrow to the fixed vocabulary
 * ({@link MUSIC_VOCALS} / {@link MUSIC_VOCAL_GENDERS}). Same whole-map-drop
 * discipline as {@link readLookMap}: a corrupt or hand-edited blob degrades to
 * ABSENT rather than leaking a half-typed object into the store — `SoundPanel`
 * already has a safe fallback (`DEFAULT_MUSIC_SELECTIONS`) for a plan that
 * carries a prompt but no usable pickers. The five OPTIONAL fields each narrow
 * on their own — one bad string costs only that field, not the whole map.
 */
function readMusicSelections(value: unknown): MusicSelections | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  const s = value as Record<string, unknown>
  const vocals = MUSIC_VOCALS.find((v) => v === s.vocals)
  const vocalGender = MUSIC_VOCAL_GENDERS.find((v) => v === s.vocalGender)
  if (!vocals || !vocalGender) return undefined
  const genre = readString(s.genre)
  const mood = readString(s.mood)
  const singingStyle = readString(s.singingStyle)
  const language = readString(s.language)
  return {
    vocals,
    vocalGender,
    instruments: [...(readStringArray(s.instruments) ?? [])],
    ...(genre ? { genre } : {}),
    ...(mood ? { mood } : {}),
    ...(singingStyle ? { singingStyle } : {}),
    ...(language ? { language } : {}),
  }
}

/** Narrow a persisted `musicPlan` blob → {@link PlanMusic}, or undefined
 *  (plan-import-v2 D5) — the parse-side twin of `copyMusicPlan`. `undefined`
 *  when the blob carries no decision at all: a blank `prompt` AND no
 *  {@link hasMusicPicks} pick. A blank prompt on its own is NOT a refusal — a
 *  PICKER-ONLY draft (a genre picked before a word is typed) is exactly what
 *  `draftMusicPlan` commits (R64/A2) and the ordinary save writes, so reading
 *  it back is what makes that save true; refusing it left the picks on the
 *  server and dropped them on every reload. That is workflow persistence, not
 *  the plan FORMAT — `toMusicDocument` still exports no soundtrack for a blank
 *  prompt, because `repairMusic` drops one on the way back in. `duration`
 *  narrows only to a FINITE number (a stray `NaN`/`Infinity` reads as absent,
 *  same as everywhere else a persisted number is untrusted). */
export function readMusicPlan(value: unknown): PlanMusic | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const m = value as Record<string, unknown>
  const prompt = readString(m.prompt)
  const selections = readMusicSelections(m.selections)
  if (!prompt && !hasMusicPicks(selections)) return undefined
  const duration =
    typeof m.duration === "number" && Number.isFinite(m.duration) ? m.duration : undefined
  return {
    prompt: prompt ?? "",
    ...(duration !== undefined ? { duration } : {}),
    ...(selections ? { selections } : {}),
  }
}

/** Narrow ONE persisted cut blob → {@link ProductionCut} (url-bearing only) —
 *  REQUIRED so the field survives a parse → serialize round-trip (an unread
 *  optional settings field is erased on the next save). */
function readCut(value: unknown): ProductionCut | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const c = value as Record<string, unknown>
  const url = readString(c.url)
  if (!url) return undefined
  return {
    id: readString(c.id) ?? crypto.randomUUID(),
    name: readString(c.name) ?? "Cut",
    url,
    exportedAt: readString(c.exportedAt) ?? "",
    ...(readString(c.freecutProjectUrl)
      ? { freecutProjectUrl: readString(c.freecutProjectUrl) }
      : {}),
    ...(readNumber(c.duration) !== undefined ? { duration: readNumber(c.duration) } : {}),
    ...(readNumber(c.shotsCount) !== undefined
      ? { shotsCount: readNumber(c.shotsCount) }
      : {}),
    ...(c.final === true ? { final: true as const } : {}),
  }
}

/** Narrow the persisted `cuts` list; falls back to MIGRATING the short-lived
 *  single `finalCut` blob (one prod build wrote it) into a one-entry list —
 *  tagged final, named "Cut A" — so no saved edit is orphaned. */
export function readCuts(studio: Record<string, unknown>): ProductionCut[] | undefined {
  const raw = studio.cuts
  if (Array.isArray(raw)) {
    const cuts = raw.flatMap((c) => readCut(c) ?? [])
    return cuts.length ? cuts : undefined
  }
  const legacy = readCut(studio.finalCut)
  return legacy ? [{ ...legacy, name: "Cut A", final: true }] : undefined
}

/** Narrow a persisted `folders` blob → {@link ProductionFolder}[] (id+name only). */
export function readFolders(value: unknown): ProductionFolder[] | undefined {
  if (!Array.isArray(value)) return undefined
  const folders: ProductionFolder[] = []
  for (const f of value) {
    if (typeof f !== "object" || f === null) continue
    const id = readString((f as Record<string, unknown>).id)
    const name = readString((f as Record<string, unknown>).name)
    if (id && name) folders.push({ id, name })
  }
  return folders.length ? folders : undefined
}

/**
 * Is this an authoritative studio index (v2 OR v3)? v2 is structurally a subset
 * of v3 (audio fields simply absent), so we read both through the v3 shape — the
 * predicate never relies on `version === 3`, only on `shots` being an array.
 */
export function isStudioIndex(studio: unknown): studio is StudioSettingsV3 {
  const version = (studio as { version?: unknown } | null)?.version
  return (
    typeof studio === "object" &&
    studio !== null &&
    (version === 2 || version === 3) &&
    Array.isArray((studio as { shots?: unknown }).shots)
  )
}

/**
 * Does the workflow's studio index (v2/v3) reference NODE-BACKED shots — i.e. does
 * it CLAIM content (≥1 entry carrying an `imageNodeId`/`videoNodeId`)?
 *
 * The decisive guard against the `shots:[]` overwrite bug: {@link parseProduction}
 * reconstructs each shot's still/clip FROM the referenced nodes and DROPS entries
 * whose node is missing/url-less. So a non-empty, node-referencing index that
 * parses to ZERO shots is a hydration FAILURE (missing/unparseable nodes — a
 * desynced save or a node-shape change after a new build), NOT a genuinely-empty
 * production. Callers MUST NOT persist an empty index over such a workflow — that
 * would destroy the user's saved work. Placeholder entries (no node ids) don't
 * count: a freshly-added empty shot is legitimately empty.
 */
export function studioIndexExpectsShots(wf: Workflow): boolean {
  const studio = (wf.settings as { studio?: unknown } | undefined)?.studio
  if (!isStudioIndex(studio)) return false
  return studio.shots.some(
    (s) =>
      readString((s as { imageNodeId?: unknown }).imageNodeId) !== undefined ||
      readString((s as { videoNodeId?: unknown }).videoNodeId) !== undefined,
  )
}

/** Defensive `Record<string,string>` reader (skips non-string values). */
function readStringMap(m: unknown): Record<string, string> | undefined {
  if (!m || typeof m !== "object") return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** Defensive `Record<string,number>` reader (skips non-number values). */
function readNumberMap(m: unknown): Record<string, number> | undefined {
  if (!m || typeof m !== "object") return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (typeof v === "number") out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** Narrow the persisted `settings.studio.storyboard` blob back to {@link StoryboardSettings}. */
export function readStoryboard(raw: unknown): StoryboardSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const s = raw as Record<string, unknown>
  const scripts = readStringMap(s.scripts)
  const breakdowns = readStringMap(s.breakdowns)
  const seconds = readNumberMap(s.seconds)
  const out: StoryboardSettings = {
    ...(s.on === true ? { on: true } : {}),
    ...(typeof s.brief === "string" ? { brief: s.brief } : {}),
    ...(typeof s.filmLength === "number" ? { filmLength: s.filmLength } : {}),
    ...(scripts ? { scripts } : {}),
    ...(breakdowns ? { breakdowns } : {}),
    ...(seconds ? { seconds } : {}),
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Narrow the persisted `settings.studio.trash` blob back to {@link TrashedItem}s.
 *
 * A CLIP entry's stored result is read by {@link readClipResults} — the same
 * narrower live clip results go through — so the bin can never read back a thinner
 * result than the shot it came from (a field added there applies here for free). A
 * SHOT entry carries a whole one-shot production graph, kept verbatim and handed
 * back to `parseProduction` on restore, for the same reason.
 *
 * `kind` is optional on read: entries written before shots could be trashed have
 * no discriminator, and a clip is what they were.
 *
 * An entry missing its identifying parts (or an unusable payload) is DROPPED
 * rather than resurrected as a row that could never be restored.
 */
export function readTrash(value: unknown): TrashedItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: TrashedItem[] = []
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue
    const rec = raw as Record<string, unknown>
    const id = readString(rec.id)
    const shotId = readString(rec.shotId)
    if (!id || !shotId) continue
    const shotName = readString(rec.shotName)
    const index = readNumber(rec.index)
    const common = {
      id,
      shotId,
      ...(shotName ? { shotName } : {}),
      index: index ?? 0,
      deletedAt: readString(rec.deletedAt) ?? "",
    }

    if (readString(rec.kind) === "shot") {
      // The stored graph must at least look like one (nodes + a studio index), or
      // a restore would produce nothing.
      const graph = rec.graph
      if (typeof graph !== "object" || graph === null) continue
      const g = graph as Record<string, unknown>
      if (!Array.isArray(g.nodes) || typeof g.settings !== "object" || g.settings === null) {
        continue
      }
      out.push({
        kind: "shot",
        ...common,
        graph: {
          nodes: g.nodes as SerializedProduction["nodes"],
          edges: Array.isArray(g.edges)
            ? (g.edges as SerializedProduction["edges"])
            : [],
          settings: g.settings as SerializedProduction["settings"],
        },
      })
      continue
    }

    if (readString(rec.kind) === "still") {
      const sb = rec.stillBase
      const sNode =
        typeof sb === "object" && sb !== null
          ? readString((sb as { nodeId?: unknown }).nodeId)
          : undefined
      if (!sNode) continue
      const sResult = readResults([rec.result])[0]
      if (!sResult) continue
      const sbRec = sb as Record<string, unknown>
      const sProvider = readString(sbRec.provider)
      const sPrompt = readString(sbRec.prompt)
      out.push({
        kind: "still",
        ...common,
        stillBase: {
          nodeId: sNode,
          ...(sProvider ? { provider: sProvider } : {}),
          ...(sPrompt ? { prompt: sPrompt } : {}),
          // This branch rebuilds the base EXPLICITLY (unlike `trashItemToWire`,
          // which spreads it whole), so the cinematic channel has to be read
          // back by name or restoring a last-deleted still loses its look.
          ...directionSpread(readNodeDirection(sbRec.direction)),
          ...subjectSpread(readNodeSubject(sbRec.subject)),
          ...structuredSpread(readNodeStructured(sbRec.structured)),
        },
        result: sResult,
      })
      continue
    }

    const base = rec.clipBase
    const nodeId =
      typeof base === "object" && base !== null
        ? readString((base as { nodeId?: unknown }).nodeId)
        : undefined
    if (!nodeId) continue
    const result = readClipResults([rec.result])[0]
    if (!result) continue
    const baseRec = base as Record<string, unknown>
    const provider = readString(baseRec.provider)
    const prompt = readString(baseRec.prompt)
    out.push({
      kind: "clip",
      ...common,
      clipBase: {
        nodeId,
        ...(provider ? { provider } : {}),
        ...(prompt ? { prompt } : {}),
        // Same explicit-rebuild hazard as the still branch above.
        ...directionSpread(readNodeDirection(baseRec.direction)),
        ...subjectSpread(readNodeSubject(baseRec.subject)),
        ...structuredSpread(readNodeStructured(baseRec.structured)),
      },
      result,
    })
  }
  return out.length ? out : undefined
}
