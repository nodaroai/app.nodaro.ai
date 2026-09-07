/**
 * The `shots` section — the ordered timeline itself.
 *
 * Seven operations, each the server-side twin of one studio store reducer
 * (`production-store-shots.ts`): add, remove (to the bin), duplicate, move,
 * rename, insert a whole graph (the paste/import primitive), and write a
 * scene's plan. Everything the timeline can do to a shot AS a shot lives here;
 * what a shot CONTAINS (its stills, clips, beats, look, voice) belongs to the
 * sections named after those.
 *
 * Three things this file does differently from the store it generalises, all
 * mandated by the contract in `../SECTIONS.md` rather than chosen here:
 *
 *  - **A missing target throws.** The store's reducers return the state
 *    untouched for an unknown id, which is right for a click that raced a
 *    delete; a batch of operations is atomic, so the same silence would apply
 *    the six ops around a mis-addressed one and report success. Every
 *    "no-op for an unknown id" becomes `op_target_missing`.
 *  - **`reorderShot(id, "left" | "right")` becomes `move_shot { id, toIndex }`.**
 *    An agent has no cursor to step, and a caller that can name the destination
 *    should not have to emit N ops to reach it. The index is CLAMPED into the
 *    timeline exactly the way the store clamps at the ends, and landing on the
 *    shot's own index is a warned no-op, not a failure.
 *  - **Nothing ambient.** The store mints ids with `crypto.randomUUID()` and
 *    stamps `new Date().toISOString()`; here the caller supplies every id it
 *    will later ADDRESS (`add_shot { id }`, `duplicate_shot { newId }`) and
 *    everything else comes from `ctx.mintId` / `ctx.now`.
 *
 * Pure and copy-on-write throughout: a handler returns a NEW production and
 * never touches the one it was handed, which is what lets `applyOps` throw
 * half-way through a batch and still hand the caller its input document.
 */
import { z } from "zod"

import { mergeCast } from "../../cast-merge"
import { readPlan, type ScenePlan } from "../../scene-plan"
import type { PlanFrame, PlanMotion, PlanVoice } from "../../scene-plan"
import type { ProductionFolder, Shot } from "../../shot"
import {
  parseProduction,
  serializeProduction,
  type SerializedProduction,
} from "../../shot-graph"
import { appendToTrash, type TrashedShot } from "../../trash"
import { opError } from "../errors"
import type { Production } from "../production"
import type { OpContext, SectionClasses, SectionHandlers } from "../types"

// ── schema helpers ──────────────────────────────────────────────────────────

/** A plain JSON object (not an array, not `null`) — the shape every structured
 *  argument below arrives as before the codec's own reader narrows it. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * A structured plan argument, typed as the codec's own type.
 *
 * The stage types (`PlanFrame`, `PlanMotion`, `PlanVoice`) are the plan
 * format's, and `readPlan` is the ONE narrower for an untrusted one — a zod
 * restatement of those shapes would be a second spelling of the vocabulary
 * that drifts the first time a lever is added. So the schema checks only that
 * an object arrived and the HANDLER narrows it through `readPlan`, which drops
 * unknown keys and mistyped fields exactly as a canvas-edited workflow's plan
 * is dropped on load.
 */
const planStage = <T>() => z.custom<T>(isPlainObject)

/** A serialized production graph — `insert_shots`' payload. Validated
 *  structurally for the same reason: `parseProduction` is the narrower, and it
 *  already degrades a malformed blob rather than throwing. */
const serializedProduction = z.custom<SerializedProduction>(
  (value) =>
    isPlainObject(value) &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    isPlainObject(value.settings),
)

// ── the schemas (arg names and shapes verbatim from spec §6) ────────────────

export const shotsOpSchemas = {
  add_shot: z.object({
    op: z.literal("add_shot"),
    id: z.string().min(1),
    afterShotId: z.string().min(1).optional(),
    name: z.string().optional(),
    plan: planStage<ScenePlan>().optional(),
  }),
  remove_shot: z.object({
    op: z.literal("remove_shot"),
    id: z.string().min(1),
  }),
  duplicate_shot: z.object({
    op: z.literal("duplicate_shot"),
    id: z.string().min(1),
    newId: z.string().min(1),
  }),
  move_shot: z.object({
    op: z.literal("move_shot"),
    id: z.string().min(1),
    toIndex: z.number().int(),
  }),
  rename_shot: z.object({
    op: z.literal("rename_shot"),
    id: z.string().min(1),
    name: z.string(),
  }),
  insert_shots: z.object({
    op: z.literal("insert_shots"),
    graph: serializedProduction,
    afterShotId: z.string().min(1).optional(),
  }),
  set_plan: z.object({
    op: z.literal("set_plan"),
    shotId: z.string().min(1),
    frame: planStage<PlanFrame>().nullable().optional(),
    motion: planStage<PlanMotion>().nullable().optional(),
    voice: planStage<PlanVoice>().nullable().optional(),
  }),
} as const

export const shotsOpClasses: SectionClasses<typeof shotsOpSchemas> = {
  add_shot: "S",
  remove_shot: "D",
  duplicate_shot: "S",
  move_shot: "S",
  rename_shot: "S",
  insert_shots: "S",
  set_plan: "S",
}

// ── shared helpers ──────────────────────────────────────────────────────────

/** The position of `id` in the timeline, or a thrown `op_target_missing`. */
function requireIndex(production: Production, id: string, what: string): number {
  const index = production.shots.findIndex((s) => s.id === id)
  if (index < 0) {
    throw opError("op_target_missing", `${what} names no shot in this production: ${id}`)
  }
  return index
}

/** How the user sees a shot: its name when it has one, else its 1-based
 *  timeline position. Never an id — receipts are prose (SECTIONS.md). */
function shotLabel(shots: ReadonlyArray<Shot>, index: number): string {
  return shots[index]?.name ?? `Shot ${index + 1}`
}

/** Replace the shot at `index`, copy-on-write. Returns `Shot[]` — the
 *  timeline's own type on `Production` — because a `ReadonlyArray` here would
 *  not satisfy it and every caller would need a cast to put the result back. */
function withShotAt(
  shots: ReadonlyArray<Shot>,
  index: number,
  shot: Shot,
): Shot[] {
  const next = [...shots]
  next[index] = shot
  return next
}

/** Where an `afterShotId` anchor inserts: just past it, or at the end when the
 *  op names none. A named anchor that is not here is the caller's mistake. */
function insertionPoint(
  production: Production,
  afterShotId: string | undefined,
): number {
  if (!afterShotId) return production.shots.length
  return requireIndex(production, afterShotId, "`afterShotId`") + 1
}

/** Pick the shot to select after removing `removedId` (prev, else next, else
 *  none) — `production-store-helpers.ts`'s `neighborAfterRemoval`, verbatim. */
function neighborAfterRemoval(
  shots: ReadonlyArray<Shot>,
  removedId: string,
): string | undefined {
  const index = shots.findIndex((s) => s.id === removedId)
  if (index === -1) return undefined
  const prev = shots[index - 1]
  const next = shots[index + 1]
  return prev?.id ?? next?.id
}

/**
 * Copy `shot` without the fields a COPY must never carry. SUBTRACTIVE like the
 * store's `cloneShot` — an enumerated rebuild silently drops every field added
 * to `Shot` afterwards, and a duplicate then hands back a lesser scene with
 * nothing to say so. The in-flight animate markers never inherit, because they
 * belong to the run that started them.
 *
 * The node ids are re-keyed off `newId` ALONE — `generate-image-<shotId>`, the
 * one derivation every other minting path uses (`stills.ts`, `clips.ts`,
 * `insert_shots`). A second scheme (the `dup-` prefix this once carried) is not
 * jointly injective with that one over caller-supplied shot ids: a production
 * already holding a shot `dup-q` and a copy minted as `q` both derived
 * `generate-image-dup-q`, and `parseProduction` keys results by node id — so a
 * reload collapsed the two and handed the older shot the copy's still. One
 * function of one unique id cannot do that. {@link nodeIdsAreFree} covers the
 * rest: a canvas-edited production may carry any node id at all.
 */
function cloneShot(source: Shot, newId: string): Shot {
  const copy: Shot = {
    ...source,
    id: newId,
    ...(source.still
      ? { still: { ...source.still, nodeId: `generate-image-${newId}` } }
      : {}),
    // Re-keyed on its own, not gated on the still: a references-only or
    // motion-bundle scene has a clip and no still, and gating dropped its take.
    ...(source.clip
      ? { clip: { ...source.clip, nodeId: `generate-video-${newId}` } }
      : {}),
  }
  delete (copy as { pendingClips?: unknown }).pendingClips
  return copy
}

/** Every canvas node id the production's shots already carry. */
function usedNodeIds(shots: ReadonlyArray<Shot>): Set<string> {
  const ids = new Set<string>()
  for (const shot of shots) {
    if (shot.still) ids.add(shot.still.nodeId)
    if (shot.clip) ids.add(shot.clip.nodeId)
  }
  return ids
}

/** The node ids a copy keyed `newId` would take, or a refusal naming the clash.
 *  A unique SHOT id is not on its own enough: a production edited in the canvas
 *  can carry a node id derived from nothing at all. */
function requireFreeNodeIds(production: Production, newId: string): void {
  const used = usedNodeIds(production.shots)
  for (const nodeId of [`generate-image-${newId}`, `generate-video-${newId}`]) {
    if (used.has(nodeId)) {
      throw opError(
        "op_invalid",
        `A canvas node ${nodeId} is already in this production — pick another \`newId\`.`,
      )
    }
  }
}

/**
 * The stages `set_plan` writes, BY NAME.
 *
 * One more of the by-name enumerators the codec's own readers share (`readPlan`
 * / `planWithoutMedia` / `isEmptyPlan` / `copyPlan` / `untokenizeRecipeProse`) —
 * a stage added to {@link ScenePlan} and to `readPlan` but not here would be
 * unwritable over the wire, silently. Exported so the guard test can compare it
 * against what `readPlan` really reads instead of restating the list a sixth
 * time.
 */
export const SET_PLAN_STAGES = ["frame", "motion", "voice"] as const

/** Narrow one plan stage through the codec's own reader, so an operation and a
 *  reloaded workflow agree on what a plan may contain. */
function readStage<K extends keyof ScenePlan>(
  stage: K,
  value: NonNullable<ScenePlan[K]>,
): ScenePlan[K] {
  return readPlan({ [stage]: value })?.[stage]
}

/**
 * The production's folders after the arriving ones meet them, plus the map from
 * an arriving folder id to the id that survived — `appendShots`' merge, with
 * `crypto.randomUUID()` replaced by `ctx.mintId` (nothing ambient, rule 4).
 *
 * `folders` is `undefined` when nothing changed AND the production had none, so
 * a folder-less production that pastes a folder-less graph stays folder-less
 * rather than gaining an empty list the serializer would have to omit again.
 */
function mergeFolders(
  current: ProductionFolder[] | undefined,
  incoming: ReadonlyArray<ProductionFolder> | undefined,
  ctx: OpContext,
): {
  // The document's own (mutable) array type — a `ReadonlyArray` here would not
  // satisfy `Production["folders"]` and every caller would need a cast.
  folders: ProductionFolder[] | undefined
  survivorOf: ReadonlyMap<string, string>
} {
  const survivorOf = new Map<string, string>()
  if (!incoming?.length) return { folders: current, survivorOf }
  const byName = new Map((current ?? []).map((f) => [f.name, f.id]))
  const merged = [...(current ?? [])]
  for (const folder of incoming) {
    const existing = byName.get(folder.name)
    if (existing) {
      survivorOf.set(folder.id, existing)
      continue
    }
    // A fresh id, like `add_folder`: an id minted by the importer is never
    // trusted into the production — it could collide with one already here.
    const id = ctx.mintId()
    byName.set(folder.name, id)
    merged.push({ id, name: folder.name })
    survivorOf.set(folder.id, id)
  }
  return { folders: merged, survivorOf }
}

/** Point a pasted shot at the folder that survived the merge, or unfile it. */
function refileShot(shot: Shot, survivorOf: ReadonlyMap<string, string>): Shot {
  if (!shot.folderId) return shot
  const folderId = survivorOf.get(shot.folderId)
  if (folderId) return { ...shot, folderId }
  const next = { ...shot }
  delete (next as { folderId?: string }).folderId
  return next
}

// ── the handlers ────────────────────────────────────────────────────────────

export const shotsHandlers: SectionHandlers<typeof shotsOpSchemas> = {
  /**
   * A new, empty shot — the "+ New Shot" card and the first rung of every
   * import that builds a production shot by shot. The store appends and
   * selects; the op can also place the shot after a named anchor, because a
   * caller writing a whole scene in one batch has an order in mind.
   */
  add_shot: (production, op, _ctx) => {
    if (production.shots.some((s) => s.id === op.id)) {
      throw opError("op_invalid", `A shot with id ${op.id} is already in this production.`)
    }
    const at = insertionPoint(production, op.afterShotId)
    // Narrowed through the codec's own reader, and REFUSED when it narrows to
    // nothing — the same answer `set_plan` gives the same argument. Dropping it
    // silently was the one place an operation could report success over an
    // instruction it never carried out.
    const plan = op.plan ? readPlan(op.plan) : undefined
    if (op.plan && !plan) {
      throw opError(
        "op_invalid",
        "`plan` carried nothing this production can store as a plan.",
      )
    }
    const name = op.name?.trim()
    const shot: Shot = {
      id: op.id,
      ...(name ? { name } : {}),
      ...(plan ? { plan } : {}),
    }
    const shots = [
      ...production.shots.slice(0, at),
      shot,
      ...production.shots.slice(at),
    ]
    return {
      production: { ...production, shots, selectedShotId: shot.id },
      receipt: { op: "add_shot", summary: `Added ${shotLabel(shots, at)}.` },
    }
  },

  /**
   * Delete a shot — to the BIN, never off the end of the world. The entry is a
   * one-shot production graph, so the shot round-trips back through the same
   * serialize/parse the production itself uses and its still history, clip
   * history, voice and keyframes all come back together (`../../trash`).
   */
  remove_shot: (production, op, ctx) => {
    const index = requireIndex(production, op.id, "`id`")
    const doomed = production.shots[index]!
    const label = shotLabel(production.shots, index)
    const shots = production.shots.filter((s) => s.id !== op.id)
    const selectedShotId =
      production.selectedShotId === op.id
        ? neighborAfterRemoval(production.shots, op.id)
        : production.selectedShotId
    const entry: TrashedShot = {
      kind: "shot",
      id: ctx.mintId(),
      shotId: doomed.id,
      ...(doomed.name ? { shotName: doomed.name } : {}),
      index,
      deletedAt: ctx.now,
      graph: serializeProduction([doomed], doomed.id),
    }
    return {
      production: {
        ...production,
        shots,
        selectedShotId,
        trash: [...appendToTrash(production.trash ?? [], entry)],
      },
      receipt: {
        op: "remove_shot",
        summary: `Deleted ${label} (in the bin).`,
        ids: [entry.id],
      },
    }
  },

  /**
   * Copy a shot beside its source. Same-production, so the folder rides along
   * (its id cannot dangle) and only identity is refreshed — see `cloneShot`.
   */
  duplicate_shot: (production, op, _ctx) => {
    const index = requireIndex(production, op.id, "`id`")
    if (production.shots.some((s) => s.id === op.newId)) {
      throw opError(
        "op_invalid",
        `A shot with id ${op.newId} is already in this production.`,
      )
    }
    requireFreeNodeIds(production, op.newId)
    const copy = cloneShot(production.shots[index]!, op.newId)
    const shots = [
      ...production.shots.slice(0, index + 1),
      copy,
      ...production.shots.slice(index + 1),
    ]
    return {
      production: { ...production, shots, selectedShotId: copy.id },
      receipt: {
        op: "duplicate_shot",
        summary: `Duplicated ${shotLabel(production.shots, index)}.`,
      },
    }
  },

  /**
   * Move a shot to a position. `toIndex` is clamped into the timeline — the
   * store's own "no-op at the ends" rule, said as an index — and a move that
   * lands where the shot already is returns the SAME `shots` array, so the
   * studio's strip does not re-render and a no-op save stays clean.
   */
  move_shot: (production, op, _ctx) => {
    const index = requireIndex(production, op.id, "`id`")
    if (!Number.isInteger(op.toIndex)) {
      throw opError("op_invalid", `\`toIndex\` must be a whole number: ${op.toIndex}`)
    }
    const last = production.shots.length - 1
    const target = Math.min(Math.max(op.toIndex, 0), last)
    const label = shotLabel(production.shots, index)
    if (target === index) {
      return {
        production,
        receipt: { op: "move_shot", summary: `${label} stayed at position ${index + 1}.` },
        warnings: [`${label} was already at position ${index + 1}.`],
      }
    }
    const shots = [...production.shots]
    const [moved] = shots.splice(index, 1)
    shots.splice(target, 0, moved!)
    return {
      production: { ...production, shots },
      receipt: {
        op: "move_shot",
        summary: `Moved ${label} to position ${target + 1}.`,
      },
    }
  },

  /**
   * Name a shot, or clear the override. A blank name is a CLEAR (back to the
   * derived label), never a stored empty string, and clearing a shot that has
   * no name returns the same array so nothing re-renders.
   */
  rename_shot: (production, op, _ctx) => {
    const index = requireIndex(production, op.id, "`id`")
    const shot = production.shots[index]!
    const trimmed = op.name.trim()
    const label = shotLabel(production.shots, index)
    if (!trimmed) {
      if (!shot.name) {
        return {
          production,
          receipt: { op: "rename_shot", summary: `${label} had no name to clear.` },
          warnings: [`${label} had no name to clear.`],
        }
      }
      const cleared = { ...shot }
      delete (cleared as { name?: string }).name
      return {
        production: {
          ...production,
          shots: withShotAt(production.shots, index, cleared),
        },
        receipt: { op: "rename_shot", summary: `Cleared the name of ${label}.` },
      }
    }
    return {
      production: {
        ...production,
        shots: withShotAt(production.shots, index, { ...shot, name: trimmed }),
      },
      receipt: {
        op: "rename_shot",
        summary: `Renamed ${label} to “${trimmed}”.`,
      },
    }
  },

  /**
   * Insert a whole serialized production — the paste, the "Import scene…" and
   * the Director's append, all one primitive.
   *
   * Every id is RE-MINTED (`ctx.mintId`): the same bundle pasted twice, or
   * pasted back into the production it came from, must not collide on a shot
   * id or a canvas node id. In-flight job markers belong to the run that
   * started them and are dropped.
   *
   * FOLDERS TRAVEL AS NAMES (`appendShots`, `production-store-shots.ts` L52).
   * A folder the arriving graph declares under a name this production already
   * uses IS that folder — the shot is remapped onto the survivor and nothing is
   * created; a name that is new is created with a FRESH id, never the file's
   * (an importer's id could collide with one here); and a `folderId` the graph
   * never declared cannot be resolved at all, so the shot lands unfiled rather
   * than dangling. That last case is the clipboard's whole story — a copied
   * scene carries a folder id and no folder list — which is why one primitive
   * serves both the paste and the Director's append (R18: Phase 1 replaces the
   * append's mechanism, not its semantics).
   *
   * The arriving CAST meets the one already here through `mergeCast` — an
   * actor already cast keeps its role, a free name is enrolled as-is, and a
   * name already taken by a DIFFERENT actor takes the suffix, with the PASTED
   * prose rewritten to say so. Scoped to the arriving shots: the scenes already
   * here said what they meant, and they still mean it.
   */
  insert_shots: (production, op, ctx) => {
    const at = insertionPoint(production, op.afterShotId)
    const source = parseProduction({
      id: "clipboard",
      name: "clipboard",
      nodes: op.graph.nodes,
      edges: op.graph.edges,
      settings: op.graph.settings,
    })
    if (source.shots.length === 0) {
      return {
        production,
        receipt: { op: "insert_shots", summary: "Pasted nothing — the graph had no shots.", ids: [] },
        warnings: ["The graph carried no shots."],
      }
    }
    const reidentified = source.shots.map((shot) => cloneShot(shot, ctx.mintId()))
    const { folders, survivorOf } = mergeFolders(
      production.folders,
      source.folders,
      ctx,
    )
    const pastedList = reidentified.map((shot) => refileShot(shot, survivorOf))
    const cast = production.cast ?? {}
    const merged = mergeCast(cast, source.cast, pastedList)
    const landed = merged.shots
    const shots = [
      ...production.shots.slice(0, at),
      ...landed,
      ...production.shots.slice(at),
    ]
    const anchor = op.afterShotId
      ? ` after ${shotLabel(production.shots, at - 1)}`
      : " at the end"
    const noun = pastedList.length === 1 ? "shot" : "shots"
    return {
      production: {
        ...production,
        shots,
        // Land on the LAST pasted shot — the natural "keep working" cursor.
        selectedShotId: pastedList[pastedList.length - 1]!.id,
        // Compared against the SAME object that went into the merge: a second
        // `production.cast ?? {}` is a fresh `{}` every time, so a cast-less
        // production gained an empty `cast` key the parser never hands back.
        ...(merged.cast !== cast ? { cast: merged.cast } : {}),
        ...(folders ? { folders } : {}),
      },
      receipt: {
        op: "insert_shots",
        summary: `Pasted ${pastedList.length} ${noun}${anchor}.`,
        ids: pastedList.map((p) => p.id),
      },
    }
  },

  /**
   * Write a scene's PLAN — its authored intent, per stage.
   *
   * A stage the op does not name is left alone; a stage named `null` is
   * CLEARED; a stage named with a value REPLACES that stage. Each value is
   * narrowed through the codec's own `readPlan`, so an operation can put
   * nothing in a plan that a reloaded workflow would refuse to read back — the
   * failure mode a hand-rolled schema here would eventually produce.
   *
   * The plan is authored intent and a result is a separate record: writing one
   * never touches the shot's stills or clips, and clearing the LAST stage drops
   * the `plan` key entirely so a plan-less scene persists byte-identically.
   */
  set_plan: (production, op, _ctx) => {
    const index = requireIndex(production, op.shotId, "`shotId`")
    const shot = production.shots[index]!
    const named = SET_PLAN_STAGES.filter((stage) => op[stage] !== undefined)
    if (named.length === 0) {
      throw opError("op_invalid", "`set_plan` named no stage to write or clear.")
    }
    let plan: ScenePlan = { ...(shot.plan ?? {}) }
    for (const stage of named) {
      const value = op[stage]
      // Dead at runtime — `named` already dropped the stages the op did not
      // write — but `filter` is not a type guard, so the narrowing has to be
      // said out loud. Do not "simplify" it away.
      if (value === undefined) continue
      if (value === null) {
        delete (plan as Record<string, unknown>)[stage]
        continue
      }
      const narrowed = readStage(stage, value)
      if (!narrowed) {
        throw opError(
          "op_invalid",
          `\`${stage}\` carried nothing this production can store as a plan.`,
        )
      }
      plan = { ...plan, [stage]: narrowed }
    }
    const next = { ...shot }
    if (Object.keys(plan).length > 0) {
      ;(next as { plan?: ScenePlan }).plan = plan
    } else {
      delete (next as { plan?: ScenePlan }).plan
    }
    const label = shotLabel(production.shots, index)
    return {
      production: {
        ...production,
        shots: withShotAt(production.shots, index, next),
      },
      receipt: {
        op: "set_plan",
        summary: `Updated the plan of ${label} (${named.join(", ")}).`,
      },
    }
  },
}
