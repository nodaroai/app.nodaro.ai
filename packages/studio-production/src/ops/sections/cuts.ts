/**
 * The `cuts` section — the exported versions of the film.
 *
 * Five operations, the server-side twins of `addCut` / `renameCut` /
 * `deleteCut` / `markCutFinal` / `duplicateCut` in the studio store
 * (`production-store-cuts-audio.ts`). A cut is one saved whole-production
 * edit ({@link ProductionCut}) living in `production.cuts` in APPEND order,
 * newest last; at most one carries `final: true`, a movable TAG rather than a
 * fixed slot. The FreeCut export path appends one per render, which is why
 * `add_cut` never overwrites and why the caller mints `cut.id` (D3.2) — the
 * agent that ran the export already knows the id it will later rename or tag.
 *
 * Where these ops part company with the reducers, and why:
 *
 *  - an id that names no cut is `op_target_missing`. `renameCut` and
 *    `markCutFinal` simply map over a list that does not contain it and
 *    `duplicateCut` returns `state`, because the studio's menu can only offer
 *    cuts that exist; a caller that asks the server to rename a cut that is
 *    gone has made a mistake worth rejecting the batch for.
 *  - an id the production already carries is `op_invalid`, for `add_cut`'s
 *    `cut.id` and `duplicate_cut`'s `newId` alike. Two cuts sharing an id
 *    would make every later op addressing it ambiguous.
 *
 * A blank rename is NOT an error: `renameCut` keeps the current name when the
 * new one trims to nothing, and this handler does the same and says so in a
 * warning. That behaviour is pinned by the store's own suite.
 *
 * What does NOT travel: the studio's session TOMBSTONES (`deletedCutIds`).
 * They exist only to stop the client's save-time `mergeCuts` union from
 * resurrecting a locally-deleted cut out of the server copy; they are not in
 * `settings.studio`, so they are not on `Production` and `delete_cut` cannot
 * write one. On the server the document IS the canonical copy and a delete is
 * simply a delete.
 */
import { z } from "zod"

import type { ProductionCut } from "../../shot"
import { opError } from "../errors"
import type { Production } from "../production"
import type { SectionClasses, SectionHandlers } from "../types"

// ── schemas (SECTIONS.md §12) ───────────────────────────────────────────────

/**
 * One cut, as an operation carries it.
 *
 * Local to this section by rule 7: the codec describes `ProductionCut` as a
 * TypeScript interface and has no zod mirror of it. The `satisfies` pin below
 * is what keeps the two from drifting.
 */
const productionCutSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  exportedAt: z.string(),
  freecutProjectUrl: z.string().optional(),
  duration: z.number().optional(),
  shotsCount: z.number().optional(),
  final: z.literal(true).optional(),
})

/** A parsed cut is a `ProductionCut` — a codec field added without a schema
 *  field here would be dropped on the wire, so the compiler checks it. */
type ParsedCut = z.infer<typeof productionCutSchema>
const _cutPin: ParsedCut extends ProductionCut ? true : never = true
void _cutPin

export const cutsOpSchemas = {
  add_cut: z.object({
    op: z.literal("add_cut"),
    cut: productionCutSchema,
  }),
  rename_cut: z.object({
    op: z.literal("rename_cut"),
    id: z.string(),
    name: z.string(),
  }),
  delete_cut: z.object({
    op: z.literal("delete_cut"),
    id: z.string(),
  }),
  mark_cut_final: z.object({
    op: z.literal("mark_cut_final"),
    id: z.string(),
  }),
  duplicate_cut: z.object({
    op: z.literal("duplicate_cut"),
    id: z.string(),
    /** The copy's id — minted by the caller, so a later op can address it. */
    newId: z.string(),
  }),
} as const

// ── local helpers ───────────────────────────────────────────────────────────

/** The cut list, always an array — an absent `cuts` is an empty production. */
function cutsOf(production: Production): ReadonlyArray<ProductionCut> {
  return production.cuts ?? []
}

/** The cut with this id, or a refusal naming it. */
function requireCut(production: Production, id: string): ProductionCut {
  const cut = cutsOf(production).find((c) => c.id === id)
  if (!cut) throw opError("op_target_missing", `No cut ${id} in this production.`)
  return cut
}

/** Refuse an id the production already carries — ids address, so they are unique. */
function requireFreeId(production: Production, id: string): void {
  if (cutsOf(production).some((c) => c.id === id)) {
    throw opError("op_invalid", `This production already has a cut ${id}.`)
  }
}

/** A copy of `cut` with the FINAL tag DROPPED — the key gone, never blanked
 *  (the serializer writes `final` only when it is `true`, and an explicit
 *  `undefined` would survive the spread into the persisted document). */
function untagged(cut: ProductionCut): ProductionCut {
  const { final: _drop, ...rest } = cut
  return rest
}

/** The production with a new cut list — copy-on-write, one place. */
function withCuts(
  production: Production,
  cuts: ReadonlyArray<ProductionCut>,
): Production {
  return { ...production, cuts: [...cuts] }
}

// ── handlers ────────────────────────────────────────────────────────────────

export const cutsHandlers: SectionHandlers<typeof cutsOpSchemas> = {
  // APPENDS, never overwrites: every export is a version the user keeps.
  add_cut: (production, op) => {
    requireFreeId(production, op.cut.id)
    return {
      production: withCuts(production, [...cutsOf(production), op.cut]),
      receipt: { op: "add_cut", summary: `Added cut “${op.cut.name}”.` },
    }
  },

  rename_cut: (production, op) => {
    const cut = requireCut(production, op.id)
    const name = op.name.trim()
    if (!name) {
      return {
        production,
        receipt: {
          op: "rename_cut",
          summary: `Kept the name of cut “${cut.name}”.`,
        },
        warnings: [`Kept the name “${cut.name}” — the new name was blank.`],
      }
    }
    return {
      production: withCuts(
        production,
        cutsOf(production).map((c) => (c.id === op.id ? { ...c, name } : c)),
      ),
      receipt: {
        op: "rename_cut",
        summary: `Renamed cut “${cut.name}” to “${name}”.`,
      },
    }
  },

  // The FINAL tag simply disappears with a final cut — there is nothing to move
  // it to, and the next export can claim it.
  delete_cut: (production, op) => {
    const cut = requireCut(production, op.id)
    return {
      production: withCuts(
        production,
        cutsOf(production).filter((c) => c.id !== op.id),
      ),
      receipt: { op: "delete_cut", summary: `Deleted cut “${cut.name}”.` },
    }
  },

  mark_cut_final: (production, op) => {
    const cut = requireCut(production, op.id)
    // Toggle: re-tagging the current final CLEARS it. Otherwise the tag MOVES —
    // every other cut loses it, so exactly one can ever carry it.
    const clearing = cut.final === true
    return {
      production: withCuts(
        production,
        cutsOf(production).map((c) => {
          if (c.id === op.id) {
            return clearing ? untagged(c) : { ...c, final: true as const }
          }
          return c.final ? untagged(c) : c
        }),
      ),
      receipt: {
        op: "mark_cut_final",
        summary: clearing
          ? `Cleared the final tag from “${cut.name}”.`
          : `Marked “${cut.name}” as the final cut.`,
      },
    }
  },

  duplicate_cut: (production, op) => {
    const source = requireCut(production, op.id)
    requireFreeId(production, op.newId)
    // Same media and project urls, fresh id, "<name> copy" — and never the
    // FINAL tag (there can be only one).
    const copy: ProductionCut = {
      ...untagged(source),
      id: op.newId,
      name: `${source.name} copy`,
    }
    return {
      production: withCuts(production, [...cutsOf(production), copy]),
      receipt: {
        op: "duplicate_cut",
        summary: `Duplicated cut “${source.name}” as “${copy.name}”.`,
      },
    }
  },
}

// ── classes ─────────────────────────────────────────────────────────────────
//
// `delete_cut` is the only D here. It is NOT trash-backed — the trash holds
// shots and results, not cuts — so it destroys the entry outright; the cut's
// rendered media survives in the user's asset library either way.

export const cutsOpClasses: SectionClasses<typeof cutsOpSchemas> = {
  add_cut: "S",
  rename_cut: "S",
  delete_cut: "D",
  mark_cut_final: "S",
  duplicate_cut: "S",
}
