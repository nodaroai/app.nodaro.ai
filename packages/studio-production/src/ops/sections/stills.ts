/**
 * The `stills` section — a shot's IMAGE history.
 *
 * Four operations, the server-side twins of the studio store's still-result
 * reducers (`production-store-stills.ts`): append a generated frame, step the
 * active one, delete one (to the bin) and name one. A shot's stills and its
 * clips are two INDEPENDENT histories (D12) — every handler here leaves
 * `shot.clip` exactly as it found it, including when the deletion empties the
 * still entirely, because each clip result remembers the frames it was made
 * from and a re-frame invalidates none of them.
 *
 * The invariants the ported tests pin, and which the code below exists to keep:
 *
 *  - **Histories accumulate.** A generation APPENDS (`atFront` prepends — the
 *    continuity opening); it never replaces. One `generate-image` node holds
 *    them all, so `nodeId` is stable per shot for the life of the production.
 *  - **The start frame is sticky (#7).** A landing frame ANCHORS `startFrame`
 *    only when the shot has none; SELECTING a result never moves it — and on a
 *    loaded shot that predates the anchor, the select anchors it to the
 *    OUTGOING still so the effective start frame (`startFrame ?? still.url`)
 *    stays where it was.
 *  - **A landing frame consumes the recipe's `framing` layer.** A recipe is the
 *    regeneration input of a media-less import; real work must replace it.
 *  - **INV-D.** The cinematic channel is rebased by exactly the expression that
 *    rebases `prompt`: `resultDirection`'s gate stamps a `promptFormat: 2`
 *    result's ids and stamps NOTHING for a legacy one — which is what CLEARS an
 *    inherited direction rather than leaving stale ids beside a baked prompt.
 *
 * Two places these ops part company with the reducers, both mandated by
 * `../SECTIONS.md` rather than chosen here: an id or a {@link ResultKey} that
 * names nothing is `op_target_missing` where the reducer silently no-opped (a
 * batch is atomic, so a mis-addressed op must reject it), and a genuine no-op —
 * an already-active pick, an unchanged name — hands back the SAME production
 * with a warning instead of only a reference.
 *
 * The one deliberate generalisation: the reducers address a result by INDEX,
 * these ops by {@link ResultKey} (`jobId ?? url`). Two writers hold a
 * production open at once, so an index is stale the moment either appends.
 */
import type { SubjectFields } from "@nodaro/prompts"
import type { ConnectedReference, ResultKey } from "@nodaro/shared"
import { z } from "zod"

import { resultKey } from "../../result-key"
import type {
  LookSelectionMap,
  Shot,
  ShotRecipe,
  ShotStill,
  ShotStillResult,
} from "../../shot"
import { buildStill, shotDisplayName, stillResults } from "../../shot"
import {
  carryDirection,
  carryStructured,
  resultDirection,
} from "../../shot-direction"
import { appendToTrash, type TrashedStill } from "../../trash"
import { opError } from "../errors"
import type { Production } from "../production"
import type { SectionClasses, SectionHandlers } from "../types"

// ── argument shapes (§6, verbatim) ──────────────────────────────────────────

/**
 * `pickerKey → catalog id`, or a multi-pick list of them.
 *
 * The multi-pick arm is `.readonly()` so the parsed args ARE
 * {@link LookSelectionMap} rather than a mutable look-alike — the op vocabulary
 * and the document speak one type.
 */
const lookSelectionMap = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string()).readonly()]),
)

/** The platform-keyed Person / Styling / prop bag. Its numeric arm is real
 *  (`customAge`), which is the only thing that separates it from a look map. */
const subjectFields = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string()).readonly(), z.number()]),
)

/**
 * A bound `@`-chip carried on a result, passed through UNTOUCHED.
 *
 * `z.custom` rather than a zod twin of {@link ConnectedReference}: that
 * interface carries thirty-odd provenance fields, and a hand-built object
 * schema would either strip the ones it forgot or drift from the platform's the
 * first time one is added. The predicate checks the four fields that make a
 * reference a reference; everything else rides through as it came.
 */
const connectedReference = z.custom<ConnectedReference>((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    typeof v.defaultName === "string" &&
    typeof v.source === "string" &&
    typeof v.url === "string"
  )
}, "Not a connected reference.")

/**
 * One landing generation — {@link ShotStillResult} on the wire.
 *
 * Only `url` is required: everything else is the CONTEXT a strip-click restores
 * (the prompt and model it was made with, the references that were sent, the
 * levers it was generated at, the prompt-format marker and its look ids). Every
 * field here is copied onto the stored result by an explicit list in the
 * handler, exactly as the reducer does — a field the list forgets is silently
 * erased before it ever reaches the graph.
 */
const stillResultSchema = z.object({
  url: z.string(),
  jobId: z.string().optional(),
  name: z.string().optional(),
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  provider: z.string().optional(),
  referenceImageUrls: z.array(z.string()).readonly().optional(),
  references: z.array(connectedReference).readonly().optional(),
  filerobotDesignStateUrl: z.string().optional(),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  count: z.number().optional(),
  promptFormat: z.literal(2).optional(),
  look: lookSelectionMap.optional(),
  filmLook: lookSelectionMap.optional(),
  sceneLook: lookSelectionMap.optional(),
  subject: subjectFields.optional(),
})

export const stillsOpSchemas = {
  add_still_result: z.object({
    op: z.literal("add_still_result"),
    shotId: z.string(),
    result: stillResultSchema,
    /** Insert as image #1 and make it active — the continuity opening. */
    atFront: z.boolean().optional(),
  }),
  set_active_still: z.object({
    op: z.literal("set_active_still"),
    shotId: z.string(),
    result: z.string(),
  }),
  remove_still_result: z.object({
    op: z.literal("remove_still_result"),
    shotId: z.string(),
    result: z.string(),
  }),
  rename_still_result: z.object({
    op: z.literal("rename_still_result"),
    shotId: z.string(),
    result: z.string(),
    /** Blank (or whitespace) CLEARS the name back to the derived label. */
    name: z.string(),
  }),
} as const

// ── helpers ─────────────────────────────────────────────────────────────────

/** The addressed shot and its position, or a refusal naming the id. */
function locateShot(
  production: Production,
  shotId: string,
): { readonly shot: Shot; readonly index: number } {
  const index = production.shots.findIndex((s) => s.id === shotId)
  if (index === -1) {
    throw opError("op_target_missing", `No shot ${shotId} in this production.`)
  }
  return { shot: production.shots[index]!, index }
}

/**
 * The shot's still, or a refusal.
 *
 * A still-less shot is a real shape (a storyboard placeholder, a
 * references-mode clip), so the answer to "select/delete/rename an image on it"
 * is that the target does not exist — never an invented empty still.
 */
function requireStill(shot: Shot): ShotStill {
  if (!shot.still) {
    throw opError(
      "op_target_missing",
      `Shot ${shot.id} has no images to address.`,
    )
  }
  return shot.still
}

/** The POSITION of the result a key names, or a refusal. The handlers need the
 *  index (the histories are ordered and `buildStill` takes one), so this is a
 *  `findIndex` rather than the codec's `findResult`; a duplicate key resolves to
 *  the FIRST match either way. */
function requireResultIndex(
  results: ReadonlyArray<ShotStillResult>,
  key: ResultKey,
): number {
  const index = results.findIndex((r) => resultKey(r) === key)
  if (index === -1) {
    throw opError("op_target_missing", `No image ${key} in this shot.`)
  }
  return index
}

/** Copy `production` with the shot at `index` replaced. Copy-on-write. */
function withShot(production: Production, index: number, shot: Shot): Production {
  return {
    ...production,
    shots: production.shots.map((s, i) => (i === index ? shot : s)),
  }
}

/**
 * Drop the CONSUMED `framing` layer off a shot's recipe, and the `recipe` key
 * itself once nothing is left in it. A recipe-less shot comes back by identity,
 * so the ordinary path pays nothing.
 *
 * A local copy of the store's `consumeRecipe` narrowed to this section's one
 * layer — the codec exports no equivalent (`production-store-helpers.ts` lives
 * in the studio app), and the `voice` section carries the same copy for its own
 * layer. Hoisting one shared helper into the codec is the integrator's call;
 * noted in this lane's report.
 */
function consumeFramingRecipe(shot: Shot): Shot {
  if (!shot.recipe?.framing) return shot
  const rest: ShotRecipe = { ...shot.recipe }
  delete (rest as Record<string, unknown>).framing
  const next: Shot = { ...shot }
  if (Object.keys(rest).length > 0) {
    ;(next as { recipe?: ShotRecipe }).recipe = rest
  } else {
    delete (next as { recipe?: ShotRecipe }).recipe
  }
  return next
}

/** How a take is named to a person — its 1-based position in the history. */
function takeLabel(index: number): string {
  return `take ${index + 1}`
}

/**
 * The stored result, built from the wire result by an EXPLICIT field list.
 *
 * The list is the reducer's, field for field and in its order: every optional
 * field a result carries must be copied here or it is silently erased before it
 * reaches the graph, and an omit-when-empty arm keeps a bare result byte-
 * identical to what it serialized to before the field existed (a `look: {}`
 * would read as "an armed selection of nothing" on restore).
 */
function storedResult(result: z.infer<typeof stillResultSchema>): ShotStillResult {
  return {
    url: result.url,
    ...(result.jobId ? { jobId: result.jobId } : {}),
    ...(result.prompt ? { prompt: result.prompt } : {}),
    ...(result.negativePrompt ? { negativePrompt: result.negativePrompt } : {}),
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.referenceImageUrls?.length
      ? { referenceImageUrls: [...result.referenceImageUrls] }
      : {}),
    ...(result.references?.length ? { references: [...result.references] } : {}),
    ...(result.filerobotDesignStateUrl
      ? { filerobotDesignStateUrl: result.filerobotDesignStateUrl }
      : {}),
    ...(result.name ? { name: result.name } : {}),
    ...(result.aspectRatio ? { aspectRatio: result.aspectRatio } : {}),
    ...(result.resolution ? { resolution: result.resolution } : {}),
    ...(result.count !== undefined ? { count: result.count } : {}),
    ...(result.promptFormat !== undefined
      ? { promptFormat: result.promptFormat }
      : {}),
    ...(result.look && Object.keys(result.look).length
      ? { look: result.look as LookSelectionMap }
      : {}),
    ...(result.filmLook && Object.keys(result.filmLook).length
      ? { filmLook: result.filmLook as LookSelectionMap }
      : {}),
    ...(result.sceneLook && Object.keys(result.sceneLook).length
      ? { sceneLook: result.sceneLook as LookSelectionMap }
      : {}),
    ...(result.subject && Object.keys(result.subject).length
      ? { subject: result.subject as SubjectFields }
      : {}),
  }
}

// ── handlers ────────────────────────────────────────────────────────────────

export const stillsHandlers: SectionHandlers<typeof stillsOpSchemas> = {
  add_still_result: (production, op) => {
    const { shot, index } = locateShot(production, op.shotId)
    const name = shotDisplayName(shot, index + 1)

    // Add to the shot's results (creating them on the first); the node id is
    // STABLE per shot so generations accumulate under ONE generate-image node.
    // Normally APPENDED + the newest becomes active; `atFront` inserts at index
    // 0 + makes IT active — it's the opening.
    const prev = shot.still ? stillResults(shot.still) : []
    const next = storedResult(op.result)
    const results = op.atFront ? [next, ...prev] : [...prev, next]

    // `prompt` here ALWAYS rebases (no fallback), so the cinematic channel
    // rebases with it — INV-D. An unmarked result stamps nothing, which CLEARS
    // any direction the base had inherited (see `resultDirection`).
    const still = buildStill(
      {
        nodeId: shot.still?.nodeId ?? `generate-image-${op.shotId}`,
        provider: op.result.provider,
        prompt: op.result.prompt,
        ...resultDirection(op.result, "image"),
      },
      results,
      op.atFront ? 0 : results.length - 1,
    )

    // The clip (and its whole results history) SURVIVES a new frame (D12), and
    // so do the frame-independent fields (name / folder / voice / end frame) —
    // they ride the spread. STICKY START FRAME (#7): anchor it to this fresh
    // frame only when the shot has none, so it stops SHADOWING the active still.
    // A landing frame CONSUMES the recipe's framing layer.
    const updated = consumeFramingRecipe({
      ...shot,
      still,
      ...(shot.startFrame ? {} : { startFrame: op.result.url }),
    })

    return {
      production: withShot(production, index, updated),
      receipt: {
        op: "add_still_result",
        summary: `Added ${takeLabel(results.length - 1)} to ${name}.`,
      },
    }
  },

  set_active_still: (production, op) => {
    const { shot, index } = locateShot(production, op.shotId)
    const still = requireStill(shot)
    const results = stillResults(still)
    const at = requireResultIndex(results, op.result)
    const name = shotDisplayName(shot, index + 1)
    const receipt = {
      op: "set_active_still",
      summary: `Showing ${takeLabel(at)} of ${name}.`,
    }

    // Already the shown frame: the document already reads the way the caller
    // asked for, so hand back the SAME one and say so.
    if (at === (still.activeIndex ?? 0)) {
      return {
        production,
        receipt,
        warnings: [`${takeLabel(at)} of ${name} was already the shown image.`],
      }
    }

    // STICKY START FRAME (#7): browsing results must NEVER move the effective
    // start frame (`startFrame ?? still.url`). With no explicit `startFrame`
    // (loaded/legacy shots that predate the landing anchor), anchor it to the
    // OUTGOING active still BEFORE switching — so the effective start frame
    // stays put. Only Set-as-start-frame moves it after.
    const outgoing = results[still.activeIndex ?? 0]?.url
    // A pick keeps the clip — browsing generations is a selection, not a re-frame.
    const updated: Shot = {
      ...shot,
      still: buildStill(still, results, at),
      ...(shot.startFrame || !outgoing ? {} : { startFrame: outgoing }),
    }
    return { production: withShot(production, index, updated), receipt }
  },

  remove_still_result: (production, op, ctx) => {
    const { shot, index } = locateShot(production, op.shotId)
    const still = requireStill(shot)
    const results = stillResults(still)
    const at = requireResultIndex(results, op.result)
    const name = shotDisplayName(shot, index + 1)

    // The deletion is recoverable: the whole result goes to the bin, and the
    // still's node identity rides with it so restoring the LAST one can rebuild
    // the node the canvas graph round-trips through.
    const entry: TrashedStill = {
      kind: "still",
      id: ctx.mintId(),
      shotId: op.shotId,
      ...(shot.name ? { shotName: shot.name } : {}),
      index: at,
      deletedAt: ctx.now,
      stillBase: {
        nodeId: still.nodeId,
        ...(still.provider ? { provider: still.provider } : {}),
        ...(still.prompt ? { prompt: still.prompt } : {}),
        // The cinematic channel rides with the prompt (INV-D) so a last-result
        // restore rebuilds the node with its ids, not just its prose. The
        // canvas's own `structured` rides unconditionally — it is not studio's
        // field and no result gates it.
        ...carryDirection(still),
        ...carryStructured(still),
      },
      result: results[at]!,
    }

    const remaining = [...results.slice(0, at), ...results.slice(at + 1)]
    let updated: Shot
    if (remaining.length === 0) {
      // Dropping the last remaining result clears the still entirely (the shot
      // falls back to an empty placeholder card). The clip is kept either way
      // (D12) — a still-less shot with a clip is a supported shape.
      updated = { ...shot }
      delete (updated as { still?: ShotStill }).still
    } else {
      const prevActive = still.activeIndex ?? 0
      // Repair the active index: removing a result BEFORE it shifts it left;
      // removing the active one (or one after) clamps it into the new range.
      const nextActive =
        prevActive > at ? prevActive - 1 : Math.min(prevActive, remaining.length - 1)
      updated = { ...shot, still: buildStill(still, remaining, nextActive) }
    }

    return {
      production: {
        ...withShot(production, index, updated),
        trash: [...appendToTrash(production.trash ?? [], entry)],
      },
      receipt: {
        op: "remove_still_result",
        summary: `Deleted ${takeLabel(at)} of ${name} (in the bin).`,
        ids: [entry.id],
      },
    }
  },

  rename_still_result: (production, op) => {
    const { shot, index } = locateShot(production, op.shotId)
    const still = requireStill(shot)
    const results = stillResults(still)
    const at = requireResultIndex(results, op.result)
    const name = shotDisplayName(shot, index + 1)
    const trimmed = op.name.trim()
    const receipt = {
      op: "rename_still_result",
      summary: trimmed
        ? `Renamed ${takeLabel(at)} of ${name} to “${trimmed}”.`
        : `Cleared the name of ${takeLabel(at)} of ${name}.`,
    }

    // Unchanged (blank == cleared/absent) is a no-op, not a failure.
    if ((results[at]!.name ?? "") === trimmed) {
      return {
        production,
        receipt,
        warnings: [
          trimmed
            ? `${takeLabel(at)} of ${name} was already named “${trimmed}”.`
            : `${takeLabel(at)} of ${name} had no name.`,
        ],
      }
    }

    // Set the name (blank → drop the key so it reverts to the derived label),
    // copy-on-write. `buildStill`'s keep-predicate retains a lone NAMED result,
    // and rebuilding through it is what keeps the prompt-format marker and the
    // look ids on a renamed result.
    const next = results.map((r, i) => {
      if (i !== at) return r
      const copy = { ...r }
      if (trimmed) copy.name = trimmed
      else delete (copy as { name?: string }).name
      return copy
    })
    const updated: Shot = {
      ...shot,
      still: buildStill(still, next, still.activeIndex ?? 0),
    }
    return { production: withShot(production, index, updated), receipt }
  },
}

// ── classes ─────────────────────────────────────────────────────────────────
//
// Only the deletion is a `D`, and it is trash-backed: the result lands in the
// bin whole, so the confirmation is about losing the SLOT, not the media.
// Adding, browsing and naming take nothing away.

export const stillsOpClasses: SectionClasses<typeof stillsOpSchemas> = {
  add_still_result: "S",
  set_active_still: "S",
  remove_still_result: "D",
  rename_still_result: "S",
}
