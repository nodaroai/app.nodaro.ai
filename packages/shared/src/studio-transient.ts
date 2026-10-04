/**
 * The parts of `settings.studio` that must not leave the owner's account.
 *
 * A shared production is read by anyone with the link. Three things inside the
 * document are the OWNER'S working state and nobody else's business:
 *
 * - `trash` — the recycle bin, which holds every shot, still and clip they
 *   deleted, with prompts and urls intact. A share viewer receiving the bin is
 *   the sharpest of the three: it hands out work the owner explicitly threw away.
 * - the in-flight job markers — `pendingClips` / `pendingStills` per shot, and
 *   `pendingMusic` / `pendingDraft` on the document. A viewer cannot land any
 *   of them and does not own them; all they carry across is job ids.
 * - `freecutDraftUrl` — an unsaved editor draft.
 *
 * Two more things are the owner's alone though neither is transient: a
 * scene's EMPTY media slots — unsubmitted drafts ({@link STUDIO_SHOT_DRAFT_KEYS})
 * — and a finished take's VOICE RECORD ({@link STUDIO_TAKE_VOICE_KEYS}), which
 * rides the canvas node's result rows rather than `settings`. The owner's own
 * reads and exports keep both; every other reader's projection drops them, and
 * drops them from the bin's deleted entries too.
 *
 * So is a LINKED (keyframe / sequence) production's sequence planning state
 * (T87), on the same terms: the director's sequence recommendations
 * ({@link STUDIO_SEQUENCE_PLANNING_KEYS}), a take's endpoint pins
 * ({@link STUDIO_TAKE_SEQUENCE_KEYS}, on the result rows) and a sequence take
 * unit's continuation review ({@link STUDIO_SEQUENCE_UNIT_REVIEW_KEYS}).
 *
 * They do NOT all live at the same level, and that is the whole reason this
 * file exists rather than one array: the writer puts `trash` and
 * `freecutDraftUrl` on `settings.studio` itself, and puts the per-shot markers
 * on the `settings.studio.shots[]` entry. A strip that walked only the top
 * level would pass its own test and still hand a share viewer every marker in
 * the production.
 *
 * It lives in `@nodaro/shared` because two independent readers need the SAME
 * list: the public share read (which is the reason the list exists) and the
 * production writer's own bundle projection. A second copy of a list like this
 * does not stay equal — it goes one key stale and the stale side is the one
 * that publishes.
 *
 * This is a plain JSON walker on purpose. `settings` is a free-form column that
 * a client owns end to end; the projection reads the keys it must drop and
 * nothing else, so it never needs — and must never grow — a dependency on
 * whatever writes the rest of the document.
 */

/**
 * `settings.studio`'s OWN transient keys.
 *
 * The per-shot pending lists are on this list as well as the shot one on
 * purpose: nothing writes them here today, and a stray one from an older
 * client — or from a client that is not the studio editor at all — still must
 * not ride out to a viewer.
 */
export const STUDIO_TRANSIENT_KEYS = [
  "trash",
  "pendingStills",
  "pendingClips",
  // The two markers that genuinely DO live at this level: a soundtrack render
  // and a story-planning run in flight. Same rule as the per-shot pair — they
  // name jobs on the owner's account and nobody else can land them.
  "pendingMusic",
  "pendingDraft",
  "freecutDraftUrl",
] as const

/**
 * ...and a SHOT entry's, which is where the per-shot markers actually are.
 *
 * `pendingClip` (singular) is the pre-concurrent-markers shape; the editor's
 * reader still migrates it on parse, so a row can still be carrying one and it
 * is still in-flight state.
 */
export const STUDIO_SHOT_TRANSIENT_KEYS = ["pendingClips", "pendingClip", "pendingStills"] as const

/**
 * ...and a SHOT entry's owner DRAFTS: the studio's empty media slots — a slot
 * the owner opened and filled in but has not generated from yet.
 *
 * Not transient — the owner's own exports and copies keep them — so they are
 * NOT on {@link STUDIO_SHOT_TRANSIENT_KEYS}. They are unsubmitted prose and
 * reference urls the owner never generated, so no OTHER reader receives them.
 * The studio codec keeps its own copy of these two keys for its own non-owner
 * projection.
 */
export const STUDIO_SHOT_DRAFT_KEYS = ["stillSlots", "clipSlots"] as const

/** Everything a shot entry loses on its way to a reader who is not its owner. */
const STUDIO_SHOT_PRIVATE_KEYS: ReadonlyArray<string> = [...STUDIO_SHOT_TRANSIENT_KEYS, ...STUDIO_SHOT_DRAFT_KEYS]

/**
 * ...and a finished TAKE's voice record (studio ruling T42): the plan a clip
 * was recast with (`revoiceTo` — the owner's voice ids) and the Voice control's
 * mode (`voiceMode`). Both live on the RESULT, so on a canvas node's
 * `data.generatedResults` rows — never on `settings.studio.shots[]`, which is
 * why no settings strip reaches them ({@link stripStudioTakeVoiceRecords} does).
 *
 * Results only: a scene recipe's `voiceMode` and a clip's `revoicedVoiceId` /
 * `revoicedVoiceName` are not a take's record and stay. The studio codec keeps
 * its own copy of these two keys (`READER_PRIVATE_TAKE_KEYS`) for its own
 * non-owner projections, as it does the slot pair.
 */
export const STUDIO_TAKE_VOICE_KEYS = ["revoiceTo", "voiceMode"] as const

/**
 * ...and a finished TAKE's SEQUENCE PINS (studio ruling T87): the exact
 * keyframe results a linked scene's clip was generated between
 * (`sequenceEndpoints`). Like the voice record it rides the RESULT, on a canvas
 * node's `data.generatedResults` rows, so the same walker drops both
 * ({@link stripStudioTakeVoiceRecords}). The in-flight marker carrying the same
 * pins (`pendingClips[].sequenceEndpoints`) already goes whole with
 * {@link STUDIO_SHOT_TRANSIENT_KEYS}.
 */
export const STUDIO_TAKE_SEQUENCE_KEYS = ["sequenceEndpoints"] as const

/** Everything a result row loses on its way to a reader who is not its owner. */
const STUDIO_TAKE_PRIVATE_KEYS: ReadonlyArray<string> = [...STUDIO_TAKE_VOICE_KEYS, ...STUDIO_TAKE_SEQUENCE_KEYS]

/**
 * ...and a LINKED production's SEQUENCE PLANNING state on `settings.studio`
 * itself (T87): `sequenceRecommendations`, the director's suggested generation
 * policies for each sequence, with their reasons and provenance.
 *
 * The studio codec's non-owner view withholds three more things that NO list
 * here carries: `sequenceGenerationPolicies`, a take's `policy` and
 * `compilation`, and a unit video node's `data.sequenceUnitResults`. The codec's
 * reader refuses a production with takes when any of them is missing, so a
 * strip of the stored row cannot drop them without breaking every reader's load
 * of that production; the codec withholds them from its own view, after it has
 * read the row.
 */
export const STUDIO_SEQUENCE_PLANNING_KEYS = ["sequenceRecommendations"] as const

/**
 * ...and a sequence TAKE's per-unit review (T87), on
 * `settings.studio.sequenceTakes[].units[]`: `continuationAcceptance` — which
 * result the owner accepted as the next continuation's predecessor, who, when,
 * and the review checks.
 */
export const STUDIO_SEQUENCE_UNIT_REVIEW_KEYS = ["continuationAcceptance"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function withoutKeys(
  source: Record<string, unknown>,
  drop: ReadonlyArray<string>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (drop.includes(key)) continue
    kept[key] = value
  }
  return kept
}

/**
 * `settings.studio.shots` with the given per-shot keys removed.
 *
 * Returns the SAME array when no shot carried one, so an idle production's
 * share read allocates nothing. Anything that is not a shot-shaped object rides
 * through untouched: this runs on whatever is in the column, and a projection
 * that threw on an unexpected row would take the share read down with it.
 */
function stripShots(value: unknown, drop: ReadonlyArray<string>): unknown {
  if (!Array.isArray(value)) return value
  let changed = false
  const out = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry
    const shot = entry as Record<string, unknown>
    if (!drop.some((key) => key in shot)) return entry
    changed = true
    return withoutKeys(shot, drop)
  })
  return changed ? out : value
}

/**
 * A production's `settings` with the owner's working state removed.
 *
 * Copy-on-write, and structurally: it rebuilds the objects without those keys
 * rather than deleting from the caller's, so the stored row is untouched. A
 * `settings` with no `studio` comes back unchanged — this is a studio concern,
 * and a workflow that is not a production has nothing here to strip.
 *
 * Takes and returns `unknown` because the column is free-form and every caller
 * already holds it as whatever its own layer calls JSON; narrowing here would
 * only move the cast one line up.
 */
export function stripStudioTransientSettings(settings: unknown): unknown {
  if (!settings || typeof settings !== "object") return settings
  const studio = (settings as { studio?: unknown }).studio
  if (!studio || typeof studio !== "object" || Array.isArray(studio)) return settings

  const source = studio as Record<string, unknown>
  const kept = withoutKeys(source, STUDIO_TRANSIENT_KEYS)
  const shots = stripShots(source.shots, STUDIO_SHOT_PRIVATE_KEYS)
  if (source.shots !== undefined) kept.shots = shots
  const planned = stripSequencePlanning(kept)

  // Nothing to drop at any level — hand back the original object so an
  // ordinary share read allocates nothing.
  if (Object.keys(kept).length === Object.keys(source).length && shots === source.shots && planned === kept) {
    return settings
  }
  return { ...(settings as Record<string, unknown>), studio: planned }
}

/**
 * A workflow's `nodes` with every result row's voice record removed
 * ({@link STUDIO_TAKE_VOICE_KEYS}, T42) and its sequence pins
 * ({@link STUDIO_TAKE_SEQUENCE_KEYS}, T87). Named for the first of the two.
 *
 * Every node's `data.generatedResults` is walked, not only a clip node's: the
 * keys exist only on clip takes, and a type list would be one more thing to
 * keep in step. Copy-on-write, and the SAME array back when no row carries
 * any of the keys. Anything that is not node-shaped rides through untouched:
 * this runs on whatever is in the column.
 */
export function stripStudioTakeVoiceRecords(nodes: unknown): unknown {
  if (!Array.isArray(nodes)) return nodes
  let changed = false
  const out = nodes.map((node: unknown) => {
    const data = isRecord(node) ? node.data : undefined
    const rows = isRecord(data) ? data.generatedResults : undefined
    if (!Array.isArray(rows)) return node
    let touched = false
    const kept = rows.map((row: unknown) => {
      if (!isRecord(row) || !STUDIO_TAKE_PRIVATE_KEYS.some((key) => key in row)) return row
      touched = true
      return withoutKeys(row, STUDIO_TAKE_PRIVATE_KEYS)
    })
    if (!touched) return node
    changed = true
    return { ...(node as Record<string, unknown>), data: { ...(data as Record<string, unknown>), generatedResults: kept } }
  })
  return changed ? out : nodes
}

/**
 * `settings.studio` without a linked production's sequence planning state
 * (T87): its own {@link STUDIO_SEQUENCE_PLANNING_KEYS}, and every sequence
 * take's units without their {@link STUDIO_SEQUENCE_UNIT_REVIEW_KEYS}. Every
 * other part of a take stays: the codec's reader needs it to read the row.
 *
 * The ONE change site for both settings strips. The SAME object back when it
 * carries none of it, and anything that is not take-shaped rides through.
 */
function stripSequencePlanning(studio: Record<string, unknown>): Record<string, unknown> {
  const takes = stripTakeUnitReviews(studio.sequenceTakes)
  if (!STUDIO_SEQUENCE_PLANNING_KEYS.some((key) => key in studio) && takes === studio.sequenceTakes) return studio
  const kept = withoutKeys(studio, STUDIO_SEQUENCE_PLANNING_KEYS)
  if (takes !== studio.sequenceTakes) kept.sequenceTakes = takes
  return kept
}

/** `settings.studio.sequenceTakes` with every unit's review removed; the SAME array back when no unit carries one. */
function stripTakeUnitReviews(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  let changed = false
  const out = value.map((take: unknown) => {
    if (!isRecord(take) || !Array.isArray(take.units)) return take
    let touched = false
    const units = take.units.map((unit: unknown) => {
      if (!isRecord(unit) || !STUDIO_SEQUENCE_UNIT_REVIEW_KEYS.some((key) => key in unit)) return unit
      touched = true
      return withoutKeys(unit, STUDIO_SEQUENCE_UNIT_REVIEW_KEYS)
    })
    if (!touched) return take
    changed = true
    return { ...take, units }
  })
  return changed ? out : value
}

/**
 * `settings` with every SHOT's owner-private state removed — its empty media
 * slots ({@link STUDIO_SHOT_DRAFT_KEYS}) and its in-flight run markers
 * ({@link STUDIO_SHOT_TRANSIENT_KEYS}) — and the bin kept WITHOUT the owner's
 * drafts in it ({@link stripBin}: deleted empty slots, deleted takes' voice
 * records) — and without a linked production's sequence planning state
 * ({@link stripSequencePlanning}, T87). The document-level markers and
 * everything else stay.
 *
 * For a reader the owner let LOOK but not edit: a `view` reader's
 * `GET /v1/workflows/:id` and `GET /v1/workflows/:id/export`, and the MCP
 * `get_workflow_json` / `export_workflow` tools on the same access — each
 * through {@link stripStudioDraftWorkflow}, which strips the nodes as well.
 * The markers go with the slots because a viewer cannot land the owner's runs,
 * and a marker for a run started from a slot carries that slot's unsent
 * inputs. An editor keeps all of it: their editor saves `settings` back whole.
 *
 * The very same object back when neither a shot, the bin nor the sequence
 * planning carries any of it.
 */
export function stripStudioDraftSettings(settings: unknown): unknown {
  if (!settings || typeof settings !== "object") return settings
  const studio = (settings as { studio?: unknown }).studio
  if (!isRecord(studio)) return settings
  const shots = stripShots(studio.shots, STUDIO_SHOT_PRIVATE_KEYS)
  const trash = stripBin(studio.trash)
  const planned = stripSequencePlanning(studio)
  if (shots === studio.shots && trash === studio.trash && planned === studio) return settings
  const kept: Record<string, unknown> = { ...planned }
  if (shots !== studio.shots) kept.shots = shots
  if (trash !== studio.trash) kept.trash = trash
  return { ...(settings as Record<string, unknown>), studio: kept }
}

/**
 * The owner's BIN (`settings.studio.trash`) as a `view` reader receives it —
 * T11, T42 and T87 applied to what the owner deleted:
 *
 * - a deleted EMPTY slot (`kind: "slot"`) goes whole: it is an unsubmitted
 *   draft, prose and reference urls the owner never generated;
 * - a deleted SCENE (`kind: "shot"`) is a one-scene production graph, so it
 *   gets what a live production gets: its takes' records and sequence pins off
 *   the graph's nodes, its slots and runs off the graph's scene entry, and its
 *   sequence planning off the graph's settings;
 * - any other entry — a deleted take (`kind: "clip"`, or a legacy entry with
 *   no kind, which the bin reads as a clip) — keeps its result without the
 *   voice record or the sequence pins. A deleted still or keyframe carries
 *   none and rides through.
 *
 * Mirrors the studio codec's `withoutBinDrafts` branch for branch (that walker
 * does not drop the T87 state yet). Copy-on-write, the SAME array back when no
 * entry carries any of it, and anything that is not an entry rides through
 * untouched.
 */
function stripBin(trash: unknown): unknown {
  if (!Array.isArray(trash)) return trash
  let changed = false
  const out: unknown[] = []
  for (const entry of trash as unknown[]) {
    if (isRecord(entry) && entry.kind === "slot") {
      changed = true
      continue
    }
    const kept = !isRecord(entry) ? entry : entry.kind === "shot" ? binSceneForReader(entry) : binTakeForReader(entry)
    if (kept !== entry) changed = true
    out.push(kept)
  }
  return changed ? out : trash
}

/** A deleted scene's graph through the two `view` strips. */
function binSceneForReader(entry: Record<string, unknown>): Record<string, unknown> {
  const graph = entry.graph
  if (!isRecord(graph)) return entry
  const nodes = stripStudioTakeVoiceRecords(graph.nodes)
  const settings = stripStudioDraftSettings(graph.settings)
  if (nodes === graph.nodes && settings === graph.settings) return entry
  return { ...entry, graph: { ...graph, nodes, settings } }
}

/** A deleted take without its voice record or sequence pins; any other entry as it is. */
function binTakeForReader(entry: Record<string, unknown>): Record<string, unknown> {
  const result = entry.result
  if (!isRecord(result) || !STUDIO_TAKE_PRIVATE_KEYS.some((key) => key in result)) return entry
  return { ...entry, result: withoutKeys(result, STUDIO_TAKE_PRIVATE_KEYS) }
}

/**
 * A workflow row as a reader the owner let LOOK but not edit receives it: the
 * takes' voice records and sequence pins off its `nodes`
 * ({@link stripStudioTakeVoiceRecords}) and the owner's drafts, runs and
 * sequence planning off its `settings` ({@link stripStudioDraftSettings}).
 *
 * The ONE strip every `view` door applies, so no door can strip the settings
 * and forget the nodes. A half the row does not carry is not added. Copy-on-
 * write, and the very same row back when neither half changed.
 */
export function stripStudioDraftWorkflow<T extends { nodes?: unknown; settings?: unknown }>(row: T): T {
  const nodes = "nodes" in row ? stripStudioTakeVoiceRecords(row.nodes) : row.nodes
  const settings = "settings" in row ? stripStudioDraftSettings(row.settings) : row.settings
  if (nodes === row.nodes && settings === row.settings) return row
  return {
    ...row,
    ...(nodes !== row.nodes ? { nodes } : {}),
    ...(settings !== row.settings ? { settings } : {}),
  }
}
